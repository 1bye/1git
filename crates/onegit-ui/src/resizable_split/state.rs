use super::SplitAxis;
use rake::gpui::{self, Context, px};

pub(super) const DIVIDER: f32 = 6.;
pub(super) const STEP: f32 = 10.;

/// Preferred-size changes from user interaction or [`SplitState::resize`], independent of viewport constraints.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SplitEvent {
    /// The first pane was resized. The application may save this value as a preference.
    Resized(gpui::Pixels),
}

pub(super) struct Config {
    pub axis: SplitAxis,
    pub min_first: gpui::Pixels,
    pub min_second: gpui::Pixels,
    pub disabled: bool,
    pub divider_size: gpui::Pixels,
    pub mount: gpui::EntityId,
}

struct Drag {
    origin: gpui::Pixels,
    size: gpui::Pixels,
    preferred: gpui::Pixels,
    fraction: Option<f32>,
}

/// Window-owned split sizing and divider focus. Viewport changes preserve the chosen size or proportion.
pub struct SplitState {
    preferred: gpui::Pixels,
    fraction: Option<f32>,
    pub(super) actual: gpui::Pixels,
    pub(super) axis: SplitAxis,
    pub(super) min_first: gpui::Pixels,
    pub(super) min_second: gpui::Pixels,
    pub(super) available: gpui::Pixels,
    pub(super) disabled: bool,
    divider_size: gpui::Pixels,
    pub(super) focus: gpui::FocusHandle,
    drag: Option<Drag>,
    window: gpui::WindowId,
    mount: Option<gpui::EntityId>,
    _activation: gpui::Subscription,
}

impl std::fmt::Debug for SplitState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SplitState")
            .field("size", &self.actual)
            .field("preferred", &self.preferred)
            .finish_non_exhaustive()
    }
}

impl gpui::EventEmitter<SplitEvent> for SplitState {}

impl gpui::Focusable for SplitState {
    fn focus_handle(&self, _: &gpui::App) -> gpui::FocusHandle {
        self.focus.clone()
    }
}

pub(super) fn nonnegative(value: gpui::Pixels) -> gpui::Pixels {
    let value: f32 = value.into();

    px(if value.is_finite() { value.max(0.) } else { 0. })
}

impl SplitState {
    /// Create state in its construction window, optionally restoring a saved logical-pixel size.
    pub fn new(size: gpui::Pixels, window: &mut gpui::Window, cx: &mut Context<Self>) -> Self {
        let size = nonnegative(size);

        let activation = cx.observe_window_activation(window, |state, window, cx| {
            if !window.is_window_active() {
                state.cancel(window, cx);
            }
        });

        Self {
            preferred: size,
            fraction: None,
            actual: size,
            axis: SplitAxis::Horizontal,
            min_first: px(120.),
            min_second: px(120.),
            available: size + px(120.),
            disabled: false,
            divider_size: px(DIVIDER),
            focus: cx.focus_handle(),
            drag: None,
            window: window.window_handle().window_id(),
            mount: None,
            _activation: activation,
        }
    }

    /// Create a split that preserves a fraction of the available space as the viewport changes.
    /// Fractions are clamped to 0–1; nonfinite input uses an equal split.
    pub fn proportional(fraction: f32, window: &mut gpui::Window, cx: &mut Context<Self>) -> Self {
        let mut state = Self::new(px(0.), window, cx);

        state.fraction = Some(if fraction.is_finite() {
            fraction.clamp(0., 1.)
        } else {
            0.5
        });

        state
    }

    /// Effective first-pane size, after the last layout constrained it to the available space.
    #[must_use]
    pub fn size(&self) -> gpui::Pixels {
        self.actual
    }

    /// Change the first-pane size and emit `Resized` when it changes. Nonfinite/negative values become zero.
    ///
    /// # Panics
    /// Panics when called in a different window.
    pub fn resize(
        &mut self,
        size: gpui::Pixels,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        self.bind(window);
        let size = self.clamp(nonnegative(size));

        if self.preferred != size {
            self.preferred = size;

            if self.fraction.is_some() && self.available > px(0.) {
                self.fraction = Some(f32::from(size) / f32::from(self.available));
            }

            self.actual = size;
            cx.emit(SplitEvent::Resized(size));
            cx.notify();
        }
    }

    fn bind(&self, window: &gpui::Window) {
        assert_eq!(
            self.window,
            window.window_handle().window_id(),
            "split state belongs to its construction window"
        );
    }

    pub(super) fn limits(&self) -> (gpui::Pixels, gpui::Pixels) {
        let total = f64::from(self.min_first) + f64::from(self.min_second);

        if total > f64::from(self.available) && total > 0. {
            let share = (f64::from(self.min_first) / total) as f32;
            let size = self.available * share;

            (size, size)
        } else {
            (
                self.min_first.min(self.available),
                (self.available - self.min_second).max(px(0.)),
            )
        }
    }

    fn clamp(&self, value: gpui::Pixels) -> gpui::Pixels {
        let (min, max) = self.limits();

        value.clamp(min, max)
    }

    pub(super) fn measure(&mut self, length: gpui::Pixels) {
        self.available = (length - self.divider_size).max(px(0.));
        self.actual = self.clamp(
            self.fraction
                .map_or(self.preferred, |fraction| self.available * fraction),
        );
    }

    pub(super) fn configure(
        &mut self,
        config: Config,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        self.bind(window);
        assert!(
            self.mount.is_none_or(|id| id == config.mount),
            "mount each SplitState in one ResizableSplit"
        );

        if config.disabled || self.axis != config.axis {
            self.cancel(window, cx);
        }

        if config.disabled && self.focus.is_focused(window) {
            window.blur();
        }

        self.axis = config.axis;
        self.min_first = nonnegative(config.min_first);
        self.min_second = nonnegative(config.min_second);
        self.disabled = config.disabled;
        self.divider_size = nonnegative(config.divider_size).max(px(1.));
        self.mount = Some(config.mount);
    }

    pub(super) fn unmount(
        &mut self,
        id: gpui::EntityId,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        if self.mount == Some(id) {
            self.cancel(window, cx);
            self.mount = None;
        }
    }

    pub(super) fn start(
        &mut self,
        position: gpui::Point<gpui::Pixels>,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        if self.disabled {
            return;
        }

        self.drag = Some(Drag {
            origin: self.axis.coordinate(position),
            size: self.actual,
            preferred: self.preferred,
            fraction: self.fraction,
        });
        window.focus(&self.focus, cx);
        cx.notify();
    }

    pub(super) fn move_pointer(
        &mut self,
        event: &gpui::MouseMoveEvent,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        let Some(drag) = &self.drag else {
            return;
        };

        if event.pressed_button != Some(gpui::MouseButton::Left) {
            self.cancel(window, cx);

            return;
        }

        let size = drag.size + self.axis.coordinate(event.position) - drag.origin;

        self.resize(size, window, cx);
        cx.stop_propagation();
    }

    pub(super) fn dragging(&self) -> bool {
        self.drag.is_some()
    }

    pub(super) fn end(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        if self.drag.take().is_some() {
            window.release_pointer();
            cx.notify();
        }
    }

    pub(super) fn cancel(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        if let Some(drag) = self.drag.take() {
            self.preferred = drag.preferred;
            self.fraction = drag.fraction;
            self.actual = self.clamp(
                self.fraction
                    .map_or(self.preferred, |fraction| self.available * fraction),
            );
            window.release_pointer();
            cx.emit(SplitEvent::Resized(if self.fraction.is_some() {
                self.actual
            } else {
                self.preferred
            }));
            cx.notify();
        }
    }

    pub(super) fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        if self.disabled {
            return;
        }

        let modifiers = &event.keystroke.modifiers;

        if modifiers.control || modifiers.alt || modifiers.platform || modifiers.function {
            return;
        }

        let step = px(if modifiers.shift { STEP * 4. } else { STEP });
        let (min, max) = self.limits();

        let next = match (self.axis, event.keystroke.key.as_str()) {
            (_, "escape") if self.dragging() => {
                self.cancel(window, cx);
                window.prevent_default();
                cx.stop_propagation();

                return;
            }
            (SplitAxis::Horizontal, "left") | (SplitAxis::Vertical, "up") => self.actual - step,
            (SplitAxis::Horizontal, "right") | (SplitAxis::Vertical, "down") => self.actual + step,
            (_, "home") => min,
            (_, "end") => max,
            _ => return,
        };

        self.resize(next, window, cx);
        window.prevent_default();
        cx.stop_propagation();
    }
}
