use super::{
    Toast, ToastAction, ToastLifetime,
    motion::{EXIT_DURATION, Presentation, SharedPresentation},
};
use rake::gpui::{self, Context};
use std::time::{Duration, Instant};
use std::{cell::RefCell, rc::Rc};

/// At most three cards are shown; prefer displacing old transient feedback over persistent work.
const CAPACITY: usize = 3;
/// Opaque identity of one notification in its owning [`ToastState`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ToastId(u64);
impl ToastId {
    pub(super) fn element(self) -> gpui::ElementId {
        ("toast", self.0).into()
    }
}
pub(super) struct Entry {
    pub id: ToastId,
    pub toast: Toast,
    pub focus: gpui::FocusHandle,
    pub dismiss: gpui::FocusHandle,
    pub action: gpui::FocusHandle,
    pub presentation: SharedPresentation,
    remaining: Option<Duration>,
    started: Option<Instant>,
}
impl Entry {
    fn duration(toast: &Toast) -> Option<Duration> {
        match toast.lifetime {
            ToastLifetime::Persistent => None,
            ToastLifetime::Timed(duration) => Some(duration),
        }
    }
}
struct Drag {
    id: ToastId,
    start: gpui::Point<gpui::Pixels>,
    origin: gpui::Pixels,
    offset: gpui::Pixels,
}
#[derive(Clone)]
pub(super) struct Config {
    pub fallback: gpui::FocusHandle,
    pub paused: bool,
    pub width: gpui::Pixels,
    pub mount: gpui::EntityId,
}
/// Retained notifications and one deadline timer for one window. Mount one [`super::ToastHost`].
/// Publishing and updates never take focus. Dismissal does not cancel application work.
pub struct ToastState {
    pub(super) entries: Vec<Entry>,
    pub(super) exiting: Vec<(Entry, Instant)>,
    drag: Option<Drag>,
    pub(super) focus: gpui::FocusHandle,
    pub(super) config: Option<Config>,
    pub(super) hovered: bool,
    pub(super) focused: bool,
    window: gpui::WindowId,
    active: bool,
    mounted: bool,
    next_id: u64,
    return_focus: Option<gpui::WeakFocusHandle>,
    timer: gpui::Task<()>,
    _subscriptions: Vec<gpui::Subscription>,
}
impl std::fmt::Debug for ToastState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToastState")
            .field("count", &self.entries.len())
            .field("window", &self.window)
            .finish_non_exhaustive()
    }
}
impl gpui::Focusable for ToastState {
    fn focus_handle(&self, _: &gpui::App) -> gpui::FocusHandle {
        self.focus.clone()
    }
}
impl ToastState {
    /// Create a retained notification state in its construction window.
    pub fn new(window: &mut gpui::Window, cx: &mut Context<Self>) -> Self {
        let focus = cx.focus_handle();
        let entered = cx.on_focus_in(&focus, window, |this, _, cx| {
            this.focused = true;
            this.rearm(cx);
            cx.notify();
        });
        let left = cx.on_focus_out(&focus, window, |this, _, _, cx| {
            this.focused = false;
            this.rearm(cx);
            cx.notify();
        });
        let active = cx.observe_window_activation(window, |this, window, cx| {
            this.active = window.is_window_active();
            if !this.active {
                this.cancel_drag(window, cx);
            }
            this.rearm(cx);
            cx.notify();
        });
        Self {
            entries: Vec::new(),
            exiting: Vec::new(),
            drag: None,
            focus,
            config: None,
            hovered: false,
            focused: false,
            window: window.window_handle().window_id(),
            active: window.is_window_active(),
            mounted: false,
            next_id: 0,
            return_focus: None,
            timer: gpui::Task::ready(()),
            _subscriptions: vec![entered, left, active],
        }
    }
    /// Publish a notification without moving focus. Keep the returned ID for progress updates.
    /// At capacity, displace the oldest unfocused timed card, otherwise the oldest unfocused card.
    ///
    /// # Panics
    /// Panics when used in a different window, or if notification IDs are exhausted.
    pub fn show(
        &mut self,
        toast: Toast,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> ToastId {
        self.bind(window);
        self.remember_focus(window, cx);
        let id = ToastId(self.next_id);
        self.next_id = self.next_id.checked_add(1).expect("toast IDs exhausted");
        self.accrue(cx.background_executor().now());
        if self.entries.len() == CAPACITY {
            let index = self
                .entries
                .iter()
                .position(|e| {
                    e.remaining.is_some()
                        && !e.focus.contains_focused(window, cx)
                        && !self.dragging(e.id)
                })
                .or_else(|| {
                    self.entries
                        .iter()
                        .position(|e| !e.focus.contains_focused(window, cx) && !self.dragging(e.id))
                })
                .expect("three cards cannot all be protected by one focus and one drag");
            let entry = self.entries.remove(index);
            self.exit(entry, cx);
        }
        let remaining = Entry::duration(&toast);
        self.entries.push(Entry {
            id,
            toast,
            focus: cx.focus_handle(),
            dismiss: cx.focus_handle(),
            action: cx.focus_handle(),
            remaining,
            started: None,
            presentation: Rc::new(RefCell::new(Presentation::new(
                cx.background_executor().now(),
            ))),
        });
        self.rearm(cx);
        cx.notify();
        id
    }
    /// Replace content and restart its lifetime while preserving card identity and focus handles.
    /// Returns false for dismissed, expired or displaced IDs; stale updates never resurrect a toast.
    ///
    /// # Panics
    /// Panics when used in a different window.
    #[must_use]
    pub fn update(
        &mut self,
        id: ToastId,
        toast: Toast,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> bool {
        self.bind(window);
        self.remember_focus(window, cx);
        self.accrue(cx.background_executor().now());
        let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) else {
            return false;
        };
        if entry.action.is_focused(window) && toast.action.is_none() {
            window.focus(&entry.dismiss, cx);
        }
        entry.remaining = Entry::duration(&toast);
        entry.toast = toast;
        self.rearm(cx);
        cx.notify();
        true
    }
    /// Remove one notification, restoring focus only if one of its controls held focus.
    /// Dismissing progress only hides feedback; the application operation continues.
    ///
    /// # Panics
    /// Panics when used in a different window.
    pub fn dismiss(
        &mut self,
        id: ToastId,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> bool {
        self.bind(window);
        let Some(index) = self.entries.iter().position(|entry| entry.id == id) else {
            return false;
        };
        let focused = self.entries[index].focus.contains_focused(window, cx);
        let entry = self.entries.remove(index);
        self.exit(entry, cx);
        if self.drag.as_ref().is_some_and(|drag| drag.id == id) {
            self.drag = None;
            window.release_pointer();
        }
        if self.entries.is_empty() {
            self.hovered = false;
            self.focused = false;
        }
        if focused {
            if let Some(next) = self
                .entries
                .get(index.min(self.entries.len().saturating_sub(1)))
            {
                window.focus(&next.dismiss, cx);
            } else {
                self.restore_focus(window, cx);
            }
        }
        self.rearm(cx);
        cx.notify();
        true
    }
    /// Remove all notifications without cancelling operations or invoking their actions.
    ///
    /// # Panics
    /// Panics when used in a different window.
    pub fn clear(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        self.bind(window);
        let focused = self.focus.contains_focused(window, cx);
        for entry in std::mem::take(&mut self.entries) {
            self.exit(entry, cx);
        }
        if self.drag.take().is_some() {
            window.release_pointer();
        }
        self.hovered = false;
        self.focused = false;
        if focused {
            self.restore_focus(window, cx);
        }
        self.rearm(cx);
        cx.notify();
    }
    /// Read current content; absent for expired, dismissed or displaced notifications.
    #[must_use]
    pub fn get(&self, id: ToastId) -> Option<&Toast> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| &entry.toast)
    }
    /// Number of displayed notifications, capped at three.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    /// Whether no notifications remain.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    fn bind(&self, window: &gpui::Window) {
        assert_eq!(
            self.window,
            window.window_handle().window_id(),
            "toast state belongs to its construction window"
        );
    }
    pub(super) fn remember_focus(&mut self, window: &gpui::Window, cx: &gpui::App) {
        if !self.focus.contains_focused(window, cx)
            && let Some(focus) = window.focused(cx)
        {
            self.return_focus = Some(focus.downgrade());
        }
    }
    fn restore_focus(&self, window: &mut gpui::Window, cx: &mut gpui::App) {
        if let Some(config) = &self.config {
            if let Some(target) = self
                .return_focus
                .as_ref()
                .and_then(gpui::WeakFocusHandle::upgrade)
                .filter(|target| config.fallback.contains(target, window))
            {
                window.focus(&target, cx);
            } else {
                window.focus(&config.fallback, cx);
            }
        } else {
            window.blur();
        }
    }
    pub(super) fn configure(
        &mut self,
        config: Config,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        self.bind(window);
        assert!(
            !self.mounted
                || self
                    .config
                    .as_ref()
                    .is_none_or(|old| old.mount == config.mount),
            "mount a ToastState in only one ToastHost"
        );
        let changed = !self.mounted
            || self.config.as_ref().is_none_or(|old| {
                old.paused != config.paused
                    || old.width != config.width
                    || old.fallback != config.fallback
            });
        if config.paused {
            self.cancel_drag(window, cx);
        }
        self.mounted = true;
        self.config = Some(config);
        self.active = window.is_window_active();
        self.remember_focus(window, cx);
        if changed {
            self.rearm(cx);
            cx.notify();
        }
    }
    pub(super) fn unmount(
        &mut self,
        mount: gpui::EntityId,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        if self
            .config
            .as_ref()
            .is_none_or(|config| config.mount != mount)
        {
            return;
        }
        if self.focus.contains_focused(window, cx) {
            self.restore_focus(window, cx);
        }
        self.cancel_drag(window, cx);
        self.exiting.clear();
        self.mounted = false;
        self.hovered = false;
        self.focused = false;
        self.rearm(cx);
    }
    pub(super) fn hover(&mut self, value: bool, cx: &mut Context<Self>) {
        if self.hovered != value {
            self.hovered = value;
            self.rearm(cx);
        }
    }
    pub(super) fn sync_focus(&mut self, value: bool, cx: &mut Context<Self>) {
        if self.focused != value {
            self.focused = value;
            self.rearm(cx);
        }
    }
    pub(super) fn take_action(
        &mut self,
        id: ToastId,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> Option<ToastAction> {
        if self.config.as_ref().is_some_and(|c| c.paused) {
            return None;
        }
        let action = self
            .entries
            .iter_mut()
            .find(|e| e.id == id)?
            .toast
            .action
            .take()?;
        self.dismiss(id, window, cx);
        Some(action)
    }
    fn accrue(&mut self, now: Instant) {
        for entry in &mut self.entries {
            if let (Some(remaining), Some(started)) = (&mut entry.remaining, entry.started.take()) {
                *remaining = remaining.saturating_sub(now.duration_since(started));
            }
        }
    }
    fn exit(&mut self, mut entry: Entry, cx: &gpui::App) {
        if !self.mounted || cx.reduce_motion() {
            return;
        }
        let now = cx.background_executor().now();
        entry.toast.action = None;
        entry.presentation.borrow_mut().exit(now);
        if self.exiting.len() == CAPACITY {
            self.exiting.remove(0);
        }
        self.exiting.push((entry, now + EXIT_DURATION));
    }
    pub(super) fn dragging(&self, id: ToastId) -> bool {
        self.drag.as_ref().is_some_and(|drag| drag.id == id)
    }
    pub(super) fn start_drag(
        &mut self,
        id: ToastId,
        point: gpui::Point<gpui::Pixels>,
        cx: &mut Context<Self>,
    ) {
        if self.config.as_ref().is_some_and(|config| config.paused)
            || !self.entries.iter().any(|entry| entry.id == id)
        {
            return;
        }
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .expect("drag target is present");
        let mut presentation = entry.presentation.borrow_mut();
        let origin = presentation.offset();
        presentation.drag(origin, cx.background_executor().now());
        drop(presentation);
        self.drag = Some(Drag {
            id,
            start: point,
            origin,
            offset: origin,
        });
        self.rearm(cx);
        cx.notify();
    }
    pub(super) fn move_drag(
        &mut self,
        event: &gpui::MouseMoveEvent,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        let Some(drag) = &mut self.drag else {
            return;
        };
        if event.pressed_button != Some(gpui::MouseButton::Left) {
            self.cancel_drag(window, cx);
            return;
        }
        let delta = event.position - drag.start;
        // Vertical intent belongs to scrolling, and small clicks should not jiggle the card.
        if drag.offset == drag.origin
            && delta.y.abs() > delta.x.abs()
            && delta.y.abs() > gpui::px(6.)
        {
            self.cancel_drag(window, cx);
            return;
        }
        if delta.x.abs() < gpui::px(6.) && drag.offset == drag.origin {
            return;
        }
        drag.offset = drag.origin + delta.x;
        if let Some(entry) = self.entries.iter().find(|entry| entry.id == drag.id) {
            entry
                .presentation
                .borrow_mut()
                .drag(drag.offset, cx.background_executor().now());
        }
        cx.notify();
        cx.stop_propagation();
    }
    pub(super) fn end_drag(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let Some(drag) = self.drag.take() else {
            return;
        };
        window.release_pointer();
        let width = self
            .entries
            .iter()
            .find(|entry| entry.id == drag.id)
            .and_then(|entry| entry.presentation.borrow().bounds)
            .map_or(gpui::px(340.), |b| b.size.width);
        // A deliberate pull of roughly a quarter-card dismisses; short pulls spring home.
        if drag.offset.abs() >= (width * 0.28).clamp(gpui::px(56.), gpui::px(100.)) {
            self.dismiss(drag.id, window, cx);
        } else {
            if let Some(entry) = self.entries.iter().find(|entry| entry.id == drag.id) {
                entry
                    .presentation
                    .borrow_mut()
                    .settle(cx.background_executor().now());
            }
            self.rearm(cx);
            cx.notify();
        }
    }
    fn cancel_drag(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        if let Some(drag) = self.drag.take() {
            if let Some(entry) = self.entries.iter().find(|entry| entry.id == drag.id) {
                entry
                    .presentation
                    .borrow_mut()
                    .settle(cx.background_executor().now());
            }
            window.release_pointer();
            self.rearm(cx);
            cx.notify();
        }
    }
    fn rearm(&mut self, cx: &mut Context<Self>) {
        let now = cx.background_executor().now();
        self.accrue(now);
        self.timer = gpui::Task::ready(());
        self.exiting
            .retain(|(_, deadline)| *deadline > now && !cx.reduce_motion());
        let paused = !self.mounted
            || !self.active
            || self.hovered
            || self.focused
            || self.drag.is_some()
            || self.config.as_ref().is_some_and(|c| c.paused);
        if !paused {
            let mut index = 0;
            while index < self.entries.len() {
                if self.entries[index]
                    .remaining
                    .is_some_and(|time| time.is_zero())
                {
                    let entry = self.entries.remove(index);
                    self.exit(entry, cx);
                } else {
                    index += 1;
                }
            }
        }
        let mut next = self
            .exiting
            .iter()
            .map(|(_, deadline)| deadline.saturating_duration_since(now))
            .min();
        if !paused {
            for entry in &mut self.entries {
                if let Some(remaining) = entry.remaining {
                    entry.started = Some(now);
                    next = Some(next.map_or(remaining, |old| old.min(remaining)));
                }
            }
        }
        if let Some(delay) = next {
            self.timer = cx.spawn(async move |this, cx| {
                cx.background_executor().timer(delay).await;
                let _ = this.update(cx, |this, cx| {
                    this.rearm(cx);
                    cx.notify();
                });
            });
        }
    }
}
