//! Source tab motion: one shared selection, interrupted tweens, live constrained drag and label reveal.
use super::{RepositoryWorkspace, Request};
use gpui_ce_motion::{Bezier, Easing, MotionValue, Transition};
use rake::gpui::{self, prelude::*, px};

use std::{
    cell::RefCell,
    collections::HashMap,
    rc::Rc,
    sync::OnceLock,
    time::{Duration, Instant},
};

pub(super) const WIDTH: f64 = 210.;
pub(super) const HEIGHT: f32 = 36.;
pub(super) const LABEL_WIDTH: f64 = 135.;

fn slide() -> Transition {
    static EASE: OnceLock<Transition> = OnceLock::new();

    *EASE.get_or_init(|| {
        Transition::Tween(
            Duration::from_millis(240),
            Easing::Bezier(
                Bezier::new(0.22, 1., 0.36, 1.).expect("source tab easing is monotonic"),
            ),
        )
    })
}

struct Track {
    x: MotionValue,
    hover: MotionValue,
    close: MotionValue,
    label: MotionValue,
}

struct Gesture {
    id: u64,
    order: Vec<u64>,
    start_x: f64,
    x: f64,
    start_scroll: f64,
    start_left: f64,
    left: f64,
    started: bool,
    over: u64,
}

pub(super) struct Presentation {
    epoch: Instant,
    tracks: HashMap<u64, Track>,
    selection: Option<MotionValue>,
    gesture: Option<Gesture>,
    scroll_tick: Option<Instant>,
    pub hovered: Option<u64>,
    pub suppress_click: bool,
    pub settling: Option<u64>,
}

pub(super) type Shared = Rc<RefCell<Presentation>>;

pub(super) struct Target {
    pub id: u64,
    pub x: f64,
    pub active: bool,
    pub changes: usize,
    pub focused: bool,
    pub text_width: f64,
}

pub(super) struct Frame {
    pub x: f32,
    pub hover: f32,
    pub close: f32,
    pub label: f32,
    pub dragging: bool,
    pub animating: bool,
}

impl Presentation {
    pub fn new(now: Instant) -> Self {
        Self {
            epoch: now,
            tracks: HashMap::new(),
            selection: None,
            gesture: None,
            scroll_tick: None,
            hovered: None,
            suppress_click: false,
            settling: None,
        }
    }

    fn time(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.epoch)
    }

    pub fn order(&self, ids: &[u64]) -> Vec<u64> {
        let mut order = ids.to_vec();

        if let Some(drag) = &self.gesture
            && drag.started
            && let (Some(from), Some(to)) = (
                order.iter().position(|id| *id == drag.id),
                order.iter().position(|id| *id == drag.over),
            )
        {
            let id = order.remove(from);

            order.insert(to, id);
        }

        order
    }

    pub fn prune(&mut self, ids: &[u64]) {
        self.tracks.retain(|id, _| ids.contains(id));

        if self.settling.is_some_and(|id| !ids.contains(&id)) {
            self.settling = None;
        }

        if self.hovered.is_some_and(|id| !ids.contains(&id)) {
            self.hovered = None;
        }

        if self
            .gesture
            .as_ref()
            .is_some_and(|drag| !ids.contains(&drag.id))
        {
            self.cancel();
        }
    }

    pub fn frame(&mut self, target: Target, now: Instant, reduced: bool) -> Frame {
        let Target {
            id,
            x: target,
            active,
            changes,
            focused,
            text_width,
        } = target;

        let time = self.time(now);

        let dragging = self
            .gesture
            .as_ref()
            .is_some_and(|drag| drag.started && drag.id == id);

        let reveal = (self.hovered == Some(id) || focused) && !self.dragging();
        let hover = self.hovered == Some(id) && !active && !self.dragging();

        let dragged = self
            .gesture
            .as_ref()
            .filter(|drag| drag.started && drag.id == id)
            .map(|drag| drag.left);

        let track = self.tracks.entry(id).or_insert_with(|| Track {
            x: MotionValue::new(target),
            hover: MotionValue::new(0.),
            close: MotionValue::new(f64::from(active && changes == 0)),
            label: MotionValue::new(0.),
        });

        if let Some(left) = dragged {
            track.x.jump(left, time);
        } else {
            track.x.animate(target, slide(), time);
        }

        track.hover.animate(
            f64::from(hover),
            Transition::Tween(Duration::from_millis(80), Easing::EaseOut),
            time,
        );
        track.close.animate(
            f64::from(reveal || (active && changes == 0)),
            Transition::Tween(Duration::from_millis(80), Easing::EaseOut),
            time,
        );
        let overflow = if reveal {
            (text_width - LABEL_WIDTH).ceil().max(0.)
        } else {
            0.
        };

        if overflow > 1. {
            track.label.animate_delayed(
                overflow,
                Transition::Tween(
                    Duration::from_secs_f64((overflow / 48.).clamp(0.7, 2.2)),
                    Easing::Linear,
                ),
                Duration::from_millis(320),
                time,
            );
        } else {
            track.label.animate(
                0.,
                Transition::Tween(
                    Duration::from_millis(220),
                    match slide() {
                        Transition::Tween(_, ease) => ease,
                        _ => Easing::EaseOut,
                    },
                ),
                time,
            );
        }

        let x = track.x.sample(time, reduced);
        let hover = track.hover.sample(time, reduced);
        let close = track.close.sample(time, reduced);
        let label = track.label.sample(time, reduced);

        if self.settling == Some(id) && !x.is_animating() {
            self.settling = None;
        }

        Frame {
            x: x.value() as f32,
            hover: hover.value() as f32,
            close: close.value() as f32,
            label: label.value() as f32,
            dragging,
            animating: x.is_animating()
                || hover.is_animating()
                || close.is_animating()
                || label.is_animating(),
        }
    }

    pub fn selection(
        &mut self,
        target: Option<f64>,
        now: Instant,
        reduced: bool,
    ) -> (Option<f32>, bool) {
        let Some(target) = target else {
            self.selection = None;

            return (None, false);
        };

        let time = self.time(now);
        let drag = self.dragging();

        let motion = self
            .selection
            .get_or_insert_with(|| MotionValue::new(target));

        if drag {
            motion.jump(target, time);
        } else {
            motion.animate(target, slide(), time);
        }

        let frame = motion.sample(time, reduced);

        (Some(frame.value() as f32), frame.is_animating())
    }

    pub fn begin(&mut self, id: u64, x: f64, scroll: f64, ids: &[u64], now: Instant) {
        self.suppress_click = false;
        self.scroll_tick = None;
        let time = self.time(now);

        let start_left = self
            .tracks
            .get_mut(&id)
            .map(|track| track.x.sample(time, false).value())
            .unwrap_or_else(|| ids.iter().position(|item| *item == id).unwrap_or(0) as f64 * WIDTH);

        self.gesture = Some(Gesture {
            id,
            order: ids.to_vec(),
            start_x: x,
            x,
            start_scroll: scroll,
            start_left,
            left: start_left,
            started: false,
            over: id,
        });
    }

    pub fn move_to(&mut self, x: f64, scroll: f64) -> Option<u64> {
        let drag = self.gesture.as_mut()?;

        drag.x = x;

        if !drag.started && (x - drag.start_x).abs() < 8. {
            return None;
        }

        let first = !drag.started;

        drag.started = true;
        self.suppress_click = true;
        drag.left = (drag.start_left + x - drag.start_x + scroll - drag.start_scroll)
            .clamp(0., drag.order.len().saturating_sub(1) as f64 * WIDTH);
        let index = (drag.left / WIDTH).round() as usize;

        drag.over = drag.order[index];

        first.then_some(drag.id)
    }

    pub fn dragging(&self) -> bool {
        self.gesture.as_ref().is_some_and(|drag| drag.started)
    }

    pub fn drag_left(&self) -> Option<f64> {
        self.gesture
            .as_ref()
            .filter(|drag| drag.started)
            .map(|drag| drag.left)
    }

    pub fn front(&self) -> Option<u64> {
        self.gesture
            .as_ref()
            .filter(|drag| drag.started)
            .map(|drag| drag.id)
            .or(self.settling)
    }

    pub fn end(&mut self) -> Option<Request> {
        let drag = self.gesture.take()?;

        if !drag.started {
            return None;
        }

        self.settling = Some(drag.id);
        self.suppress_click = true;

        Some(Request::Move(drag.id, drag.over))
    }

    pub fn cancel(&mut self) {
        if let Some(drag) = self.gesture.take()
            && drag.started
        {
            self.suppress_click = true;
            self.settling = Some(drag.id);
        }
    }

    fn autoscroll(&mut self, scroll: &gpui::ScrollHandle, now: Instant) -> bool {
        let Some(drag) = self.gesture.as_ref().filter(|drag| drag.started) else {
            return false;
        };

        let bounds = scroll.bounds();
        let x = drag.x;

        let step = if x < f64::from(bounds.left()) + 28. {
            10.
        } else if x > f64::from(bounds.right()) - 28. {
            -10.
        } else {
            0.
        };

        if step == 0. {
            self.scroll_tick = None;

            return false;
        }

        let elapsed = self.scroll_tick.replace(now).map_or(0.016, |previous| {
            now.saturating_duration_since(previous)
                .as_secs_f64()
                .min(0.05)
        });

        let step = step * elapsed / 0.016;
        let max = (drag.order.len() as f64 * WIDTH + 20. - f64::from(bounds.size.width)).max(0.);
        let offset = f64::from(scroll.offset().x);
        let next = (offset + step).clamp(-max, 0.);

        if next == offset {
            return false;
        }

        scroll.set_offset(gpui::point(px(next as f32), px(0.)));
        self.move_to(x, -next);

        true
    }
}

/// Install capture-phase drag listeners without a detached native drag image.
pub(super) struct Capture {
    pub child: gpui::AnyElement,
    pub presentation: Shared,
    pub owner: gpui::WeakEntity<RepositoryWorkspace>,
    pub scroll: gpui::ScrollHandle,
}

impl IntoElement for Capture {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for Capture {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        Some("tab-gesture-capture".into())
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
        if self
            .presentation
            .borrow_mut()
            .autoscroll(&self.scroll, cx.background_executor().now())
        {
            window.request_animation_frame();
        }

        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        self.child.prepaint(window, cx);
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
        self.child.paint(window, cx);
        let state = self.presentation.clone();
        let owner = self.owner.clone();
        let scroll = self.scroll.clone();

        window.on_mouse_event(move |event: &gpui::MouseMoveEvent, phase, window, cx| {
            if phase != gpui::DispatchPhase::Capture || state.borrow().gesture.is_none() {
                return;
            }

            let activate = if event.pressed_button == Some(gpui::MouseButton::Left) {
                state
                    .borrow_mut()
                    .move_to(event.position.x.into(), -f64::from(scroll.offset().x))
            } else {
                state.borrow_mut().cancel();

                None
            };

            let dragging = state.borrow().dragging();

            let _ = owner.update(cx, |_, cx| {
                if let Some(id) = activate {
                    cx.emit(Request::Activate(id));
                }

                cx.notify();
            });

            if dragging {
                window.prevent_default();
                cx.stop_propagation();
            }
        });
        let state = self.presentation.clone();
        let owner = self.owner.clone();

        window.on_mouse_event(move |event: &gpui::MouseUpEvent, phase, _, cx| {
            if phase != gpui::DispatchPhase::Capture || event.button != gpui::MouseButton::Left {
                return;
            }

            let dragged = state.borrow().dragging();
            let request = state.borrow_mut().end();

            let _ = owner.update(cx, |_, cx| {
                if let Some(request) = request {
                    cx.emit(request);
                }

                if dragged {
                    cx.notify();
                }
            });

            if dragged {
                cx.stop_propagation();
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_selection_slides_interrupts_and_settles_with_source_timing() {
        let now = Instant::now();
        let mut motion = Presentation::new(now);

        assert_eq!(motion.selection(Some(0.), now, false), (Some(0.), false));
        assert_eq!(motion.selection(Some(210.), now, false).0, Some(0.));
        let mid = motion
            .selection(Some(210.), now + Duration::from_millis(80), false)
            .0
            .unwrap();

        assert!(mid > 0. && mid < 210.);
        let interrupted = motion
            .selection(Some(420.), now + Duration::from_millis(80), false)
            .0
            .unwrap();

        assert_eq!(interrupted, mid);
        assert_eq!(
            motion.selection(Some(420.), now + Duration::from_millis(400), false),
            (Some(420.), false)
        );
        assert_eq!(
            motion.selection(Some(0.), now + Duration::from_millis(401), true),
            (Some(0.), false)
        );
    }

    #[test]
    fn drag_previews_order_before_commit_and_cancel_restores_it() {
        let now = Instant::now();
        let mut motion = Presentation::new(now);
        let ids = [1, 2, 3];

        motion.begin(1, 100., 0., &ids, now);
        assert_eq!(motion.move_to(107., 0.), None);
        assert!(!motion.dragging());
        assert_eq!(motion.move_to(320., 0.), Some(1));
        assert_eq!(motion.order(&ids), vec![2, 1, 3]);
        assert!(motion.drag_left().unwrap() > 210.);
        motion.cancel();
        assert_eq!(motion.order(&ids), ids);
        motion.begin(1, 100., 0., &ids, now);
        motion.move_to(400., 0.);
        assert!(matches!(motion.end(), Some(Request::Move(1, 2))));
    }

    #[test]
    fn overflowing_labels_wait_reveal_once_return_and_stop_requesting_frames() {
        let now = Instant::now();
        let mut motion = Presentation::new(now);

        let target = || Target {
            id: 1,
            x: 0.,
            active: false,
            changes: 3,
            focused: false,
            text_width: 400.,
        };

        motion.frame(target(), now, false);
        motion.hovered = Some(1);
        assert_eq!(motion.frame(target(), now, false).label, 0.);
        assert_eq!(
            motion
                .frame(target(), now + Duration::from_millis(319), false)
                .label,
            0.
        );
        assert!(
            motion
                .frame(target(), now + Duration::from_millis(1000), false)
                .label
                > 0.
        );
        let settled = motion.frame(target(), now + Duration::from_secs(4), false);

        assert_eq!(settled.label, 265.);
        assert!(!settled.animating);
        motion.hovered = None;
        motion.frame(target(), now + Duration::from_secs(4), false);
        let returned = motion.frame(target(), now + Duration::from_millis(4300), false);

        assert_eq!(returned.label, 0.);
        assert!(!returned.animating);
        motion.hovered = Some(1);
        assert!(
            !motion
                .frame(target(), now + Duration::from_secs(5), true)
                .animating
        );
    }
}
