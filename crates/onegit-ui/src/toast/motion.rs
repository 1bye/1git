//! Short native presentation tracks; hitboxes follow the same offset as the painted card.
use super::{ToastId, ToastState};
use gpui_ce_motion::{Easing, LayoutPositionState, MotionValue, Transition};
use rake::gpui::{self, prelude::*, px};
use std::{
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};

const ENTER: Transition = Transition::Tween(Duration::from_millis(160), Easing::EaseOut);
const SETTLE: Transition = Transition::Tween(Duration::from_millis(160), Easing::BackOut);
const REFLOW: Transition = Transition::Tween(Duration::from_millis(140), Easing::EaseOut);
pub(super) const EXIT_DURATION: Duration = Duration::from_millis(120);
const EXIT: Transition = Transition::Tween(EXIT_DURATION, Easing::EaseIn);
const ENTER_OFFSET: f64 = 24.;

pub(super) struct Presentation {
    epoch: Instant,
    x: MotionValue,
    opacity: MotionValue,
    layout: LayoutPositionState,
    pub bounds: Option<gpui::Bounds<gpui::Pixels>>,
}
impl Presentation {
    pub fn new(now: Instant) -> Self {
        let mut this = Self {
            epoch: now,
            x: MotionValue::new(ENTER_OFFSET),
            opacity: MotionValue::new(0.),
            layout: LayoutPositionState::default(),
            bounds: None,
        };
        this.x.animate(0., ENTER, Duration::ZERO);
        this.opacity.animate(1., ENTER, Duration::ZERO);
        this
    }
    pub fn offset(&self) -> gpui::Pixels {
        px(self.x.get() as f32)
    }
    pub fn drag(&mut self, offset: gpui::Pixels, now: Instant) {
        let time = now.saturating_duration_since(self.epoch);
        self.x.jump(offset.into(), time);
        self.opacity.jump(1., time);
    }
    pub fn settle(&mut self, now: Instant) {
        self.x
            .animate(0., SETTLE, now.saturating_duration_since(self.epoch));
    }
    pub fn exit(&mut self, now: Instant) {
        let time = now.saturating_duration_since(self.epoch);
        let distance = self
            .bounds
            .map_or(340., |bounds| f64::from(bounds.size.width));
        let target = if self.x.get() < 0. {
            -distance
        } else {
            distance
        };
        self.x.animate(target, EXIT, time);
        self.opacity.animate(0., EXIT, time);
    }
}
pub(super) type SharedPresentation = Rc<RefCell<Presentation>>;

pub(super) struct MovingCard {
    pub id: gpui::ElementId,
    pub toast: ToastId,
    pub state: Option<gpui::Entity<ToastState>>,
    pub presentation: SharedPresentation,
    pub child: gpui::AnyElement,
}
impl IntoElement for MovingCard {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl gpui::Element for MovingCard {
    type RequestLayoutState = Option<gpui::AnyElement>;
    type PrepaintState = ();
    fn id(&self) -> Option<gpui::ElementId> {
        Some(self.id.clone())
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
    ) -> (gpui::LayoutId, Self::RequestLayoutState) {
        let mut motion = self.presentation.borrow_mut();
        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(motion.epoch);
        let opacity = motion.opacity.sample(time, cx.reduce_motion());
        let swipe = motion.x.sample(time, cx.reduce_motion());
        if opacity.is_animating() || swipe.is_animating() {
            window.request_animation_frame();
        }
        let width = motion.bounds.map_or(340., |b| f64::from(b.size.width));
        let opacity = opacity.value() * (1. - (swipe.value().abs() / width.max(1.)).min(1.) * 0.4);
        let content = std::mem::replace(&mut self.child, gpui::Empty.into_any_element());
        let mut child = gpui::div()
            .w_full()
            .flex_shrink_0()
            .opacity(opacity as f32)
            .child(content)
            .into_any_element();
        (child.request_layout(window, cx), Some(child))
    }
    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        child: &mut Self::RequestLayoutState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        let mut motion = self.presentation.borrow_mut();
        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(motion.epoch);
        let origin = bounds.origin - window.element_offset();
        let layout = motion.layout.sample(
            [origin.x.into(), origin.y.into()],
            REFLOW,
            time,
            cx.reduce_motion(),
        );
        if layout.is_animating() {
            window.request_animation_frame();
        }
        motion.bounds = Some(bounds);
        let [x, y] = layout.offset();
        let offset = gpui::point(px((x + motion.x.get()) as f32), px(y as f32));
        // Moving cards escape the scroll column, within the window's toast margins.
        let viewport = window.viewport_size();
        let mask = gpui::ContentMask {
            bounds: gpui::Bounds::new(
                gpui::point(px(0.), px(16.)),
                gpui::size(viewport.width, (viewport.height - px(32.)).max(px(0.))),
            ),
        };
        window.defer_draw(
            child.take().expect("moving card prepaints once per frame"),
            window.element_offset() + offset,
            2,
            Some(mask),
        );
    }
    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut (),
        window: &mut gpui::Window,
        _: &mut gpui::App,
    ) {
        if let Some(state) = &self.state {
            let moving = state.clone();
            let id = self.toast;
            // Capture-phase listeners follow the retained gesture across moving hitboxes.
            window.on_mouse_event(move |event: &gpui::MouseMoveEvent, phase, window, cx| {
                if phase == gpui::DispatchPhase::Capture && moving.read(cx).dragging(id) {
                    moving.update(cx, |state, cx| state.move_drag(event, window, cx));
                }
            });
            let end = state.clone();
            window.on_mouse_event(move |event: &gpui::MouseUpEvent, phase, window, cx| {
                if phase == gpui::DispatchPhase::Capture
                    && event.button == gpui::MouseButton::Left
                    && end.read(cx).dragging(id)
                {
                    end.update(cx, |state, cx| state.end_drag(window, cx));
                }
            });
        }
    }
}
