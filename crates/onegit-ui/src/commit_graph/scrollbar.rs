//! Fixed-row scroll geometry keeps native thumbs accurate before virtual rows are measured.
use super::{CommitGraphScroll, CommitGraphState, ROW_HEIGHT};
use crate::Theme;
use rake::gpui::{self, ColorExt as _, prelude::*, px};

#[derive(Clone, Copy)]
pub(super) enum Axis {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy)]
pub(super) struct Drag {
    axis: Axis,
    start: f32,
    offset: f32,
    scale: f32,
}

impl CommitGraphState {
    fn position(&self, axis: Axis) -> f32 {
        match axis {
            Axis::Vertical => {
                let top = self.list.logical_scroll_top();

                top.item_ix as f32 * ROW_HEIGHT + f32::from(top.offset_in_item)
            }
            Axis::Horizontal => -f32::from(self.horizontal.offset().x),
        }
    }

    fn maximum(&self, axis: Axis) -> f32 {
        match axis {
            Axis::Vertical => {
                (self.data.len() as f32 * ROW_HEIGHT - f32::from(self.measured.height)).max(0.)
            }
            Axis::Horizontal => f32::from(self.horizontal.max_offset().x).max(0.),
        }
    }

    fn scroll_to(&mut self, axis: Axis, value: f32, cx: &mut gpui::Context<Self>) {
        let value = value.clamp(0., self.maximum(axis));

        match axis {
            Axis::Vertical => self.list.scroll_to(gpui::ListOffset {
                item_ix: (value / ROW_HEIGHT).floor() as usize,
                offset_in_item: px(value % ROW_HEIGHT),
            }),
            Axis::Horizontal => self.horizontal.set_offset(gpui::point(px(-value), px(0.))),
        }

        cx.emit(CommitGraphScroll {
            near_end: self.position(Axis::Vertical)
                + f32::from(self.measured.height)
                + ROW_HEIGHT * 10.
                >= self.data.len() as f32 * ROW_HEIGHT,
        });
        cx.notify();
    }

    pub(super) fn end_scroll_drag(&mut self) {
        self.drag = None;
    }
}

fn coordinate(axis: Axis, point: gpui::Point<gpui::Pixels>) -> f32 {
    f32::from(match axis {
        Axis::Vertical => point.y,
        Axis::Horizontal => point.x,
    })
}

struct Mount {
    _activation: gpui::Subscription,
}

pub(super) fn mount(
    id: gpui::ElementId,
    state: &gpui::Entity<CommitGraphState>,
    window: &mut gpui::Window,
    cx: &mut gpui::App,
) {
    let state = state.downgrade();

    window.use_keyed_state(id, cx, move |window, cx| {
        let released = state.clone();

        cx.on_release(move |_: &mut Mount, cx| {
            let _ = released.update(cx, |state, _| state.end_scroll_drag());
        })
        .detach();

        Mount {
            _activation: cx.observe_window_activation(window, move |_, window, cx| {
                if !window.is_window_active() {
                    let _ = state.update(cx, |state, cx| {
                        if state.drag.is_some() {
                            state.end_scroll_drag();
                            cx.notify();
                        }
                    });
                }
            }),
        }
    });
}

pub(super) fn measure(state: &gpui::Entity<CommitGraphState>) -> impl IntoElement {
    let state = state.clone();

    gpui::canvas(
        move |bounds, _, cx| {
            state.update(cx, |state, cx| {
                let horizontal = state.horizontal.max_offset().x;

                if state.measured != bounds.size || state.measured_horizontal != horizontal {
                    state.measured_horizontal = horizontal;
                    state.measured = bounds.size;
                    cx.notify();
                }
            });
        },
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

pub(super) fn bars(state: &gpui::Entity<CommitGraphState>, cx: &mut gpui::App) -> gpui::AnyElement {
    let mut result = gpui::div().absolute().inset_0().size_full();

    for (axis, id) in [
        (Axis::Vertical, "graph-scroll-vertical"),
        (Axis::Horizontal, "graph-scroll-horizontal"),
    ] {
        let model = state.read(cx);
        let maximum = model.maximum(axis);

        let extent = f32::from(match axis {
            Axis::Vertical => model.measured.height,
            Axis::Horizontal => model.measured.width,
        });

        if maximum <= 0. || extent <= 0. {
            continue;
        }

        let track = (extent - 4.).max(1.);
        let length = (track * extent / (extent + maximum)).max(24.).min(track);
        let offset = model.position(axis).clamp(0., maximum);
        let position = 2. + offset / maximum * (track - length);
        let active = model.drag.is_some();
        let moving = state.clone();
        let end = state.clone();
        let start = state.clone();
        let change = state.clone();
        let increment = state.clone();
        let decrement = state.clone();
        let theme = Theme::current();

        let thumb = gpui::div()
            .absolute()
            .rounded(px(3.))
            .bg(theme.muted_ink.opacity(if active { 0.65 } else { 0.4 }))
            .when(matches!(axis, Axis::Vertical), |s| {
                s.top(px(position)).right(px(2.)).w(px(5.)).h(px(length))
            })
            .when(matches!(axis, Axis::Horizontal), |s| {
                s.left(px(position)).bottom(px(2.)).h(px(5.)).w(px(length))
            });

        let events = gpui::canvas(
            |_, _, _| {},
            move |_, _, window, _| {
                window.on_mouse_event(move |event: &gpui::MouseMoveEvent, phase, _, cx| {
                    if phase == gpui::DispatchPhase::Capture {
                        moving.update(cx, |state, cx| {
                            if let Some(drag) = state.drag {
                                if event.pressed_button != Some(gpui::MouseButton::Left) {
                                    state.end_scroll_drag();
                                    cx.notify();

                                    return;
                                }

                                state.scroll_to(
                                    drag.axis,
                                    drag.offset
                                        + (coordinate(drag.axis, event.position) - drag.start)
                                            * drag.scale,
                                    cx,
                                );
                                cx.stop_propagation();
                            }
                        });
                    }
                });
                window.on_mouse_event(move |event: &gpui::MouseUpEvent, phase, _, cx| {
                    if phase == gpui::DispatchPhase::Capture
                        && event.button == gpui::MouseButton::Left
                    {
                        end.update(cx, |state, cx| {
                            if state.drag.is_some() {
                                state.end_scroll_drag();
                                cx.notify();
                                cx.stop_propagation();
                            }
                        });
                    }
                });
            },
        )
        .absolute()
        .size_full();

        let bar = gpui::div()
            .id(id)
            .absolute()
            .role(gpui::accesskit::Role::ScrollBar)
            .aria_label(if matches!(axis, Axis::Vertical) {
                "Commit graph vertical scroll"
            } else {
                "Commit graph horizontal scroll"
            })
            .debug_selector(move || id.into())
            .a11y_synthetic_children(move |builder| {
                let node = builder.parent_node();

                node.set_orientation(if matches!(axis, Axis::Vertical) {
                    gpui::accesskit::Orientation::Vertical
                } else {
                    gpui::accesskit::Orientation::Horizontal
                });
                node.set_numeric_value(f64::from(offset));
                node.set_min_numeric_value(0.);
                node.set_max_numeric_value(f64::from(maximum));
                node.add_action(gpui::accesskit::Action::SetValue);
                node.add_action(gpui::accesskit::Action::Increment);
                node.add_action(gpui::accesskit::Action::Decrement);
            })
            .when(matches!(axis, Axis::Vertical), |s| {
                s.top_0().bottom_0().right_0().w(px(9.))
            })
            .when(matches!(axis, Axis::Horizontal), |s| {
                s.left_0().right_0().bottom_0().h(px(9.))
            })
            .on_mouse_down(gpui::MouseButton::Left, move |event, window, cx| {
                start.update(cx, |state, cx| {
                    let bounds = state.list.viewport_bounds();
                    let local = coordinate(axis, event.position - bounds.origin);
                    let mut offset = state.position(axis);

                    if local < position || local > position + length {
                        offset = ((local - length / 2. - 2.) / (track - length).max(1.) * maximum)
                            .clamp(0., maximum);
                        state.scroll_to(axis, offset, cx);
                    }

                    state.drag = Some(Drag {
                        axis,
                        start: coordinate(axis, event.position),
                        offset,
                        scale: maximum / (track - length).max(1.),
                    });
                    window.focus(&state.focus, cx);
                    cx.stop_propagation();
                    cx.notify();
                });
            })
            .on_a11y_action(gpui::accesskit::Action::SetValue, move |data, _, cx| {
                if let Some(gpui::accesskit::ActionData::NumericValue(value)) = data
                    && value.is_finite()
                {
                    change.update(cx, |state, cx| state.scroll_to(axis, *value as f32, cx));
                }
            })
            .on_a11y_action(gpui::accesskit::Action::Increment, move |_, _, cx| {
                increment.update(cx, |state, cx| {
                    state.scroll_to(axis, state.position(axis) + ROW_HEIGHT, cx)
                })
            })
            .on_a11y_action(gpui::accesskit::Action::Decrement, move |_, _, cx| {
                decrement.update(cx, |state, cx| {
                    state.scroll_to(axis, state.position(axis) - ROW_HEIGHT, cx)
                })
            })
            .child(thumb)
            .child(events);

        result = result.child(bar);
    }

    result.into_any_element()
}
