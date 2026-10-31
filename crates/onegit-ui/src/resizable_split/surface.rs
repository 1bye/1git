use super::{
    ResizableSplit, SplitAxis,
    state::{DIVIDER, STEP},
};

use crate::{
    Theme,
    motion::{self, Surface},
};

use rake::gpui::{self, accesskit, prelude::*, px};

pub(super) struct SplitSurface {
    config: ResizableSplit,
    children: Vec<gpui::AnyElement>,
}

impl SplitSurface {
    pub fn new(config: ResizableSplit) -> Self {
        Self {
            config,
            children: Vec::new(),
        }
    }
}

impl IntoElement for SplitSurface {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for SplitSurface {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        Some("layout".into())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, ()) {
        (
            window.request_layout(
                gpui::Style {
                    size: gpui::size(gpui::relative(1.).into(), gpui::relative(1.).into()),
                    min_size: gpui::size(px(0.).into(), px(0.).into()),
                    ..Default::default()
                },
                [],
                cx,
            ),
            (),
        )
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        let axis = self.config.axis;

        self.config.state.update(cx, |state, cx| {
            state.measure(axis.length(bounds.size));
            let (min, max) = state.limits();

            if min == max && state.dragging() {
                state.cancel(window, cx);
            }
        });
        let state = self.config.state.read(cx);
        let first = state.actual;
        let (min, max) = state.limits();
        let disabled = state.disabled || min == max;
        let focus = state.focus.clone().tab_stop(!disabled);
        let dragging = state.dragging();
        let focused = focus.is_focused(window) && window.last_input_was_keyboard();

        let divider = super::state::nonnegative(self.config.divider_size)
            .max(px(1.))
            .min(axis.length(bounds.size));

        let hit_size = px(DIVIDER).max(divider);
        let second = (axis.length(bounds.size) - first - divider).max(px(0.));
        let theme = Theme::current();
        let key = self.config.state.clone();
        let start = key.clone();
        let value = key.clone();
        let increment = key.clone();
        let decrement = key.clone();
        let horizontal = axis == SplitAxis::Horizontal;
        let label = self.config.label.clone();
        let rest = Surface::new(theme.line);

        let handle = motion::surface(
            "handle-motion".into(),
            rest,
            Surface::new(theme.accent),
            Surface::new(theme.focus_ring),
            !disabled,
            move |paint| {
                gpui::div()
                    .id("divider")
                    .debug_selector(|| format!("split-{}", label))
                    .size_full()
                    .when(horizontal, |s| s.w(hit_size).ml(-(hit_size - divider) / 2.))
                    .when(!horizontal, |s| {
                        s.h(hit_size).mt(-(hit_size - divider) / 2.)
                    })
                    .flex()
                    .items_center()
                    .justify_center()
                    .role(accesskit::Role::Splitter)
                    .aria_label(label)
                    .aria_numeric_value(first.into())
                    .aria_min_numeric_value(min.into())
                    .aria_max_numeric_value(max.into())
                    .aria_numeric_value_step(STEP.into())
                    .aria_value(format!("{:.0} pixels", f32::from(first)))
                    .a11y_synthetic_children(move |builder| {
                        let node = builder.parent_node();

                        node.set_orientation(if horizontal {
                            accesskit::Orientation::Vertical
                        } else {
                            accesskit::Orientation::Horizontal
                        });

                        if disabled {
                            node.set_disabled();
                        }
                    })
                    .when(!disabled, |s| {
                        s.track_focus(&focus)
                            .tab_index(0)
                            .cursor(if horizontal {
                                gpui::CursorStyle::ResizeColumn
                            } else {
                                gpui::CursorStyle::ResizeRow
                            })
                            .on_mouse_down_all(move |event, phase, hitbox, window, cx| {
                                if phase == gpui::DispatchPhase::Bubble
                                    && event.button == gpui::MouseButton::Left
                                    && hitbox.is_hovered(window)
                                {
                                    start.update(cx, |state, cx| {
                                        state.start(event.position, window, cx)
                                    });
                                    window.capture_pointer(hitbox.id);
                                    window.prevent_default();
                                    cx.stop_propagation();
                                }
                            })
                            .on_key_down(move |event, window, cx| {
                                key.update(cx, |state, cx| state.key(event, window, cx))
                            })
                            .on_a11y_action(accesskit::Action::SetValue, move |data, window, cx| {
                                if let Some(accesskit::ActionData::NumericValue(size)) = data
                                    && size.is_finite()
                                {
                                    value.update(cx, |state, cx| {
                                        state.resize(px(*size as f32), window, cx)
                                    });
                                }
                            })
                            .on_a11y_action(accesskit::Action::Increment, move |_, window, cx| {
                                increment.update(cx, |state, cx| {
                                    state.resize(state.actual + px(STEP), window, cx)
                                });
                            })
                            .on_a11y_action(accesskit::Action::Decrement, move |_, window, cx| {
                                decrement.update(cx, |state, cx| {
                                    state.resize(state.actual - px(STEP), window, cx)
                                });
                            })
                    })
                    .child(
                        gpui::div()
                            .bg(if dragging || focused {
                                theme.focus_ring
                            } else {
                                paint.background
                            })
                            .border_color(gpui::transparent_black())
                            .when(horizontal, |s| {
                                s.w(px(if dragging || focused { 2. } else { 1. })).h_full()
                            })
                            .when(!horizontal, |s| {
                                s.h(px(if dragging || focused { 2. } else { 1. })).w_full()
                            }),
                    )
            },
        )
        .into_any_element();

        let first_content =
            std::mem::replace(&mut self.config.first, gpui::Empty.into_any_element());

        let second_content =
            std::mem::replace(&mut self.config.second, gpui::Empty.into_any_element());

        // Paint the wider hit target last so both adjacent panes leave it reachable.
        for (index, offset, length, content) in [
            (0usize, px(0.), first, first_content),
            (2, first + divider, second, second_content),
            (1, first, divider, handle),
        ] {
            let origin = bounds.origin
                + if horizontal {
                    gpui::point(offset, px(0.))
                } else {
                    gpui::point(px(0.), offset)
                };

            let size = if horizontal {
                gpui::size(length, bounds.size.height)
            } else {
                gpui::size(bounds.size.width, length)
            };

            let mut child = gpui::div()
                .id(("slot", index))
                .w(size.width)
                .h(size.height)
                .min_w_0()
                .min_h_0()
                .when(index != 1, |s| s.overflow_hidden())
                .children((size.width > px(0.) && size.height > px(0.)).then_some(content))
                .into_any_element();

            child.prepaint_as_root(
                origin,
                gpui::size(
                    gpui::AvailableSpace::Definite(size.width),
                    gpui::AvailableSpace::Definite(size.height),
                ),
                window,
                cx,
            );
            self.children.push(child);
        }
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        let moving = self.config.state.clone();
        let end = moving.clone();

        window.on_mouse_event(move |event: &gpui::MouseMoveEvent, phase, window, cx| {
            if phase == gpui::DispatchPhase::Capture && moving.read(cx).dragging() {
                moving.update(cx, |state, cx| state.move_pointer(event, window, cx));
            }
        });
        window.on_mouse_event(move |event: &gpui::MouseUpEvent, phase, window, cx| {
            if phase == gpui::DispatchPhase::Capture && event.button == gpui::MouseButton::Left {
                end.update(cx, |state, cx| state.end(window, cx));
            }
        });

        for child in &mut self.children {
            child.paint(window, cx);
        }
    }
}
