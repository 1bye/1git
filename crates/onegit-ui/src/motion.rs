//! CE-version bridge: portable gpui-ce-motion sampling, native Rake rendering/input.
//!
//! The crate's optional native adapter targets registry `gpui-ce`, while Rake pins
//! git `gpui_ce`. Keep a single renderer; retain motion in CE's scoped element state.

use gpui_ce_motion::{
    Color, ColorProperty, Easing, StyleMotion, StyleMotionState, StyleTarget, Transition,
};
use rake::gpui::{self, prelude::*};
use std::{
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};

/// Short feedback without moving hit targets or reflowing surrounding content.
const FEEDBACK: Transition = Transition::Tween(Duration::from_millis(80), Easing::EaseOut);

/// Size changes settle quickly without spring overshoot.
const RESIZE: Transition = Transition::Tween(Duration::from_millis(120), Easing::EaseOut);

#[derive(Clone, Copy)]
pub(crate) struct Surface {
    pub background: gpui::Hsla,
    pub border: gpui::Hsla,
    pub ink: gpui::Hsla,
    pub opacity: f32,
}

impl Surface {
    pub fn new(background: gpui::Hsla) -> Self {
        Self {
            background,
            border: gpui::transparent_black(),
            ink: crate::Theme::current().ink,
            opacity: 1.,
        }
    }

    fn target(self) -> StyleTarget {
        fn color(value: gpui::Hsla) -> Color {
            let value = gpui::hsla_to_rgba(value);
            Color::rgba(
                value.red.into(),
                value.green.into(),
                value.blue.into(),
                value.alpha.into(),
            )
        }
        StyleTarget::default()
            .color(ColorProperty::Background, color(self.background))
            .color(ColorProperty::Border, color(self.border))
            .color(ColorProperty::Text, color(self.ink))
    }

    fn from_target(target: StyleTarget, opacity: f32) -> Self {
        fn color(target: StyleTarget, property: ColorProperty) -> gpui::Hsla {
            let [r, g, b, a] = target
                .get_color(property)
                .expect("surface declares all paint tracks")
                .channels();
            gpui::rgb_to_hsla(gpui::Rgba::new(r, g, b, a))
        }
        Self {
            background: color(target, ColorProperty::Background),
            border: color(target, ColorProperty::Border),
            ink: color(target, ColorProperty::Text),
            opacity,
        }
    }
}

#[derive(Default)]
struct Retained {
    motion: StyleMotionState,
    epoch: Option<Instant>,
    hovered: bool,
    pressed: bool,
}

/// No extra layout node, timers or tasks. Input is observed in capture phase so
/// checkbox propagation cannot suppress its enclosing row's hover feedback.
pub(crate) struct SurfaceMotion<F> {
    id: gpui::ElementId,
    rest: Surface,
    hover: Surface,
    press: Surface,
    interactive: bool,
    build: Option<F>,
}

pub(crate) fn surface<F, E>(
    id: gpui::ElementId,
    rest: Surface,
    hover: Surface,
    press: Surface,
    interactive: bool,
    build: F,
) -> SurfaceMotion<F>
where
    F: FnOnce(Surface) -> E + 'static,
    E: IntoElement + 'static,
{
    SurfaceMotion {
        id,
        rest,
        hover,
        press,
        interactive,
        build: Some(build),
    }
}

impl<F, E> IntoElement for SurfaceMotion<F>
where
    F: FnOnce(Surface) -> E + 'static,
    E: IntoElement + 'static,
{
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl<F, E> gpui::Element for SurfaceMotion<F>
where
    F: FnOnce(Surface) -> E + 'static,
    E: IntoElement + 'static,
{
    type RequestLayoutState = gpui::AnyElement;
    type PrepaintState = gpui::Hitbox;

    fn id(&self) -> Option<gpui::ElementId> {
        Some(self.id.clone())
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, gpui::AnyElement) {
        window.with_element_state(
            id.expect("motion surfaces require stable IDs"),
            |state: Option<Rc<RefCell<Retained>>>, window| {
                let shared = state.unwrap_or_default();
                let mut state = shared.borrow_mut();
                if !self.interactive {
                    state.hovered = false;
                    state.pressed = false;
                } else if !window.is_window_active() {
                    state.pressed = false;
                }
                let target = if state.pressed && state.hovered {
                    self.press
                } else if state.hovered {
                    self.hover
                } else {
                    self.rest
                };
                let now = cx.background_executor().now();
                let epoch = *state.epoch.get_or_insert(now);
                let frame = state.motion.sample(
                    StyleMotion::new(target.target()).transition(FEEDBACK),
                    now.saturating_duration_since(epoch),
                    cx.reduce_motion(),
                );
                if frame.is_animating() {
                    window.request_animation_frame();
                }
                let paint = Surface::from_target(frame.target(), target.opacity);
                drop(state);
                let build = self
                    .build
                    .take()
                    .expect("motion surface lays out once per frame");
                let mut child = build(paint).into_any_element();
                ((child.request_layout(window, cx), child), shared)
            },
        )
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        child: &mut gpui::AnyElement,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> gpui::Hitbox {
        let hitbox = window.insert_hitbox(bounds, gpui::HitboxBehavior::Normal);
        child.prepaint(window, cx);
        hitbox
    }

    fn paint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        child: &mut gpui::AnyElement,
        hitbox: &mut gpui::Hitbox,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        if self.interactive {
            let owner = window.current_view();
            window.with_element_state(
                id.expect("motion surface ID"),
                |state: Option<Rc<RefCell<Retained>>>, window| {
                    let shared = state.expect("motion was retained during layout");
                    let region = hitbox.clone();
                    let input = shared.clone();
                    window.on_mouse_event(
                        move |event: &gpui::MouseMoveEvent, phase, window, cx| {
                            if phase != gpui::DispatchPhase::Capture {
                                return;
                            }
                            let mut state = input.borrow_mut();
                            let hovered = region.is_hovered(window);
                            let pressed = state.pressed
                                && event.pressed_button == Some(gpui::MouseButton::Left);
                            if state.hovered != hovered || state.pressed != pressed {
                                state.hovered = hovered;
                                state.pressed = pressed;
                                cx.notify(owner);
                            }
                        },
                    );
                    let region = hitbox.clone();
                    let input = shared.clone();
                    window.on_mouse_event(
                        move |event: &gpui::MouseDownEvent, phase, window, cx| {
                            if phase == gpui::DispatchPhase::Capture
                                && event.button == gpui::MouseButton::Left
                                && region.is_hovered(window)
                            {
                                let mut state = input.borrow_mut();
                                state.hovered = true;
                                state.pressed = true;
                                cx.notify(owner);
                            }
                        },
                    );
                    let input = shared.clone();
                    window.on_mouse_event(move |event: &gpui::MouseUpEvent, phase, _, cx| {
                        if phase == gpui::DispatchPhase::Capture
                            && event.button == gpui::MouseButton::Left
                        {
                            let mut state = input.borrow_mut();
                            if state.pressed {
                                state.pressed = false;
                                cx.notify(owner);
                            }
                        }
                    });
                    ((), shared)
                },
            );
        }
        child.paint(window, cx);
    }
}

/// Measure intrinsic content independently, then size the real control to the
/// sampled dimensions. Text is laid out normally rather than stretched on the GPU.
pub(crate) struct Resize<F> {
    id: gpui::ElementId,
    measurement: gpui::AnyElement,
    build: Option<F>,
}

pub(crate) fn resize<F, E>(
    id: gpui::ElementId,
    measurement: impl IntoElement,
    build: F,
) -> Resize<F>
where
    F: FnOnce(gpui::Size<gpui::Pixels>) -> E + 'static,
    E: IntoElement + 'static,
{
    Resize {
        id,
        measurement: measurement.into_any_element(),
        build: Some(build),
    }
}

struct SizeHistory {
    motion: gpui_ce_motion::LayoutPositionState,
    epoch: Instant,
}

impl<F, E> IntoElement for Resize<F>
where
    F: FnOnce(gpui::Size<gpui::Pixels>) -> E + 'static,
    E: IntoElement + 'static,
{
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl<F, E> gpui::Element for Resize<F>
where
    F: FnOnce(gpui::Size<gpui::Pixels>) -> E + 'static,
    E: IntoElement + 'static,
{
    type RequestLayoutState = gpui::AnyElement;
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        Some(self.id.clone())
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, gpui::AnyElement) {
        let measured = self.measurement.layout_as_root(
            gpui::size(
                gpui::AvailableSpace::MaxContent,
                gpui::AvailableSpace::MaxContent,
            ),
            window,
            cx,
        );
        let now = cx.background_executor().now();
        let dimensions = window.with_element_state(
            id.expect("resizing controls require stable IDs"),
            |state: Option<SizeHistory>, window| {
                let mut state = state.unwrap_or_else(|| SizeHistory {
                    motion: Default::default(),
                    epoch: now,
                });
                let frame = state.motion.sample(
                    [measured.width.into(), measured.height.into()],
                    RESIZE,
                    now.saturating_duration_since(state.epoch),
                    cx.reduce_motion(),
                );
                if frame.is_animating() {
                    window.request_animation_frame();
                }
                let [width, height] = frame.position().map(|value| gpui::px(value.max(0.) as f32));
                (gpui::size(width, height), state)
            },
        );
        let build = self
            .build
            .take()
            .expect("resizing control lays out once per frame");
        let mut child = build(dimensions).into_any_element();
        (child.request_layout(window, cx), child)
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        child: &mut gpui::AnyElement,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        child.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        child: &mut gpui::AnyElement,
        _: &mut (),
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        child.paint(window, cx);
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use gpui::{InputEvent, TestAppContext, WindowHandle, div, px};
    use std::cell::Cell;

    struct Probe {
        paint: Rc<Cell<gpui::Hsla>>,
        target: gpui::Hsla,
        enabled: bool,
    }
    impl Render for Probe {
        fn render(
            &mut self,
            _: &mut gpui::Window,
            _: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            let paint = self.paint.clone();
            let rest = Surface::new(self.target);
            let hover = Surface::new(gpui::white());
            surface(
                "probe".into(),
                rest,
                hover,
                Surface::new(gpui::black()),
                self.enabled,
                move |sample| {
                    paint.set(sample.background);
                    div().w(px(240.)).h(px(40.)).bg(sample.background).child(
                        div()
                            .id("slot")
                            .w(px(24.))
                            .h(px(24.))
                            .on_click(|_, _, cx| cx.stop_propagation()),
                    )
                },
            )
        }
    }
    fn draw(cx: &mut TestAppContext, view: WindowHandle<Probe>) {
        cx.run_until_parked();
        cx.update_window(view.into(), |_, w, cx| w.draw(cx).clear(cx))
            .expect("draw motion probe");
    }
    fn setup() -> (TestAppContext, WindowHandle<Probe>, Rc<Cell<gpui::Hsla>>) {
        let mut cx = TestAppContext::single();
        cx.update(|cx| crate::Theme::dark().install(cx));
        let paint = Rc::new(Cell::new(gpui::black()));
        let view = cx.add_window(|_, _| Probe {
            paint: paint.clone(),
            target: gpui::black(),
            enabled: true,
        });
        cx.update_window(view.into(), |_, window, _| window.activate_window())
            .expect("activate motion probe");
        draw(&mut cx, view);
        (cx, view, paint)
    }
    fn point(cx: &mut TestAppContext, view: WindowHandle<Probe>, x: f32, y: f32) {
        cx.update_window(view.into(), |_, w, cx| {
            w.dispatch_event(
                gpui::MouseMoveEvent {
                    position: gpui::point(px(x), px(y)),
                    pressed_button: None,
                    modifiers: Default::default(),
                }
                .to_platform_input(),
                cx,
            );
        })
        .expect("move pointer over motion probe");
        draw(cx, view);
    }
    fn tick(cx: &mut TestAppContext, view: WindowHandle<Probe>, time: Duration) -> usize {
        cx.executor().advance_clock(time);
        let scheduled = cx
            .update_window(view.into(), |_, w, cx| w.simulate_next_frame(cx))
            .expect("deliver animation frame");
        draw(cx, view);
        scheduled
    }
    fn lightness(value: gpui::Hsla) -> f32 {
        gpui::hsla_to_rgba(value).red
    }

    #[test]
    fn hover_covers_child_slots_and_interrupts_without_jumping_then_stops() {
        let (mut cx, view, paint) = setup();
        point(&mut cx, view, 12., 12.);
        tick(&mut cx, view, Duration::from_millis(60));
        let halfway = lightness(paint.get());
        assert!(
            halfway > 0. && halfway < 1.,
            "hover should be in flight: {halfway}"
        );
        // Leaving while in flight retargets from the current presentation.
        point(&mut cx, view, 300., 100.);
        assert!((lightness(paint.get()) - halfway).abs() < 0.001);
        tick(&mut cx, view, Duration::from_millis(150));
        assert!(lightness(paint.get()) < 0.001);
        assert_eq!(
            tick(&mut cx, view, Duration::ZERO),
            0,
            "idle surfaces must stop scheduling frames"
        );
    }

    #[test]
    fn reduced_motion_snaps_hover_and_selection_without_scheduling() {
        let (mut cx, view, paint) = setup();
        cx.update(|cx| cx.set_reduce_motion(true));
        point(&mut cx, view, 230., 12.);
        assert!(
            lightness(paint.get()) > 0.999,
            "full surface responds beyond its child slot"
        );
        assert_eq!(tick(&mut cx, view, Duration::ZERO), 0);
        view.update(&mut cx, |v, _, cx| {
            v.enabled = false;
            v.target = gpui::rgb_to_hsla(gpui::rgb(0x777777));
            cx.notify();
        })
        .expect("disable surface");
        draw(&mut cx, view);
        assert!((lightness(paint.get()) - 119. / 255.).abs() < 0.001);
        point(&mut cx, view, 12., 12.);
        assert!(
            (lightness(paint.get()) - 119. / 255.).abs() < 0.001,
            "disabled surface must ignore hover"
        );
        assert_eq!(tick(&mut cx, view, Duration::ZERO), 0);
    }
}
