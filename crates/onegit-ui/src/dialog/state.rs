use super::{DialogAvailability, DialogDismissal};
use rake::gpui::{self, AppContext, Context};
use std::{cell::RefCell, rc::Rc};

struct HostData {
    owner: gpui::AnyWeakEntity,
    window: Option<gpui::WindowId>,
    frame: u64,
    active: Option<gpui::WeakEntity<DialogState>>,
    root: gpui::FocusHandle,
    fallback: gpui::FocusHandle,
}

/// Retained, window-scoped modal ownership. Mount one [`super::DialogHost`] per window.
#[derive(Clone)]
pub struct DialogHostState(Rc<RefCell<HostData>>);

impl std::fmt::Debug for DialogHostState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DialogHostState")
            .field("window", &self.0.borrow().window)
            .finish_non_exhaustive()
    }
}

impl DialogHostState {
    /// Bind modal lifetime and redraws to the window's owning entity.
    #[must_use]
    pub fn new<T: 'static>(cx: &Context<T>) -> Self {
        Self(Rc::new(RefCell::new(HostData {
            owner: cx.entity().into_any().downgrade(),
            window: None,
            frame: 0,
            active: None,
            root: cx.focus_handle(),
            fallback: cx.focus_handle(),
        })))
    }

    /// Create retained state for one logical dialog. Opening another replaces the current modal.
    pub fn dialog(&self, cx: &mut gpui::App) -> gpui::Entity<DialogState> {
        cx.new(|cx| DialogState::new(self.clone(), cx))
    }

    /// Whether a modal owns interaction in this window.
    #[must_use]
    pub fn is_open(&self, cx: &gpui::App) -> bool {
        self.active().is_some_and(|state| state.read(cx).open)
    }

    pub(super) fn active(&self) -> Option<gpui::Entity<DialogState>> {
        self.0
            .borrow()
            .active
            .as_ref()
            .and_then(gpui::WeakEntity::upgrade)
    }

    pub(super) fn root(&self) -> gpui::FocusHandle {
        self.0.borrow().root.clone()
    }

    pub(super) fn fallback(&self) -> gpui::FocusHandle {
        self.0.borrow().fallback.clone()
    }

    fn bind(&self, window: &gpui::Window) {
        let mut host = self.0.borrow_mut();
        let id = window.window_handle().window_id();

        assert!(
            host.window.is_none_or(|bound| bound == id),
            "a dialog host belongs to one window"
        );
        host.window = Some(id);
    }

    pub(super) fn notify(&self, window: &mut gpui::Window, cx: &mut gpui::App) {
        let owner = &self.0.borrow().owner;

        if owner.is_upgradable() {
            cx.notify(owner.entity_id());
        }

        window.refresh();
    }

    pub(super) fn begin_frame(&self, window: &gpui::Window) {
        self.bind(window);
        let mut host = self.0.borrow_mut();

        host.frame = host.frame.wrapping_add(1).max(1);
    }

    pub(super) fn audit(&self, window: &mut gpui::Window, cx: &mut gpui::App) {
        let Some(active) = self.active() else {
            return;
        };

        let frame = self.0.borrow().frame;

        active.update(cx, |state, cx| {
            if !state.open {
                return;
            }

            if state.frame != frame {
                if state.opened_frame != frame {
                    state.close(window, cx);
                }

                return;
            }

            assert!(
                self.root().contains(&state.focus, window),
                "mount a dialog inside its owning DialogHost"
            );

            if state.needs_focus {
                state.needs_focus = false;
                state.focus_initial(window, cx);
            } else if !state.focus.contains_focused(window, cx) {
                state.focus_first(window, cx);
            }
        });
    }
}

/// Lifecycle notification emitted once when an open dialog closes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DialogEvent {
    /// The dialog closed through a user dismissal, explicit close, replacement or unmount.
    Closed,
}

/// Retained modal focus and lifecycle state. Create through [`DialogHostState::dialog`].
pub struct DialogState {
    pub(super) host: DialogHostState,
    pub(super) focus: gpui::FocusHandle,
    pub(super) first: gpui::FocusHandle,
    pub(super) last: gpui::FocusHandle,
    open: bool,
    frame: u64,
    opened_frame: u64,
    needs_focus: bool,
    return_focus: Option<gpui::WeakFocusHandle>,
    pub(super) initial_focus: Option<gpui::FocusHandle>,
    pub(super) availability: DialogAvailability,
    pub(super) dismissal: DialogDismissal,
    pub(super) bounds: Option<gpui::Bounds<gpui::Pixels>>,
    subscriptions: Vec<gpui::Subscription>,
}

impl std::fmt::Debug for DialogState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DialogState")
            .field("open", &self.open)
            .field("availability", &self.availability)
            .finish_non_exhaustive()
    }
}

impl gpui::EventEmitter<DialogEvent> for DialogState {}

impl gpui::Focusable for DialogState {
    fn focus_handle(&self, _: &gpui::App) -> gpui::FocusHandle {
        self.focus.clone()
    }
}

impl DialogState {
    fn new(host: DialogHostState, cx: &Context<Self>) -> Self {
        Self {
            host,
            focus: cx.focus_handle(),
            first: cx.focus_handle().tab_stop(true),
            last: cx.focus_handle().tab_stop(true),
            open: false,
            frame: 0,
            opened_frame: 0,
            needs_focus: false,
            return_focus: None,
            initial_focus: None,
            availability: DialogAvailability::Ready,
            dismissal: DialogDismissal::Escape,
            bounds: None,
            subscriptions: Vec::new(),
        }
    }

    /// Open once and remember the focused opener. Initial focus is assigned after mounting.
    /// Replacing another modal preserves that modal's original return target.
    ///
    /// # Panics
    /// Panics when used in a different window from the host.
    pub fn open(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) -> bool {
        self.host.bind(window);

        if self.open || !self.host.0.borrow().owner.is_upgradable() {
            return false;
        }

        let inherited = self.host.active().and_then(|previous| {
            previous.update(cx, |previous, cx| {
                let opener = previous.return_focus.clone();

                previous.close_inner(false, window, cx);

                opener
            })
        });

        self.open = true;
        self.needs_focus = true;
        self.opened_frame = self.host.0.borrow().frame;
        self.return_focus = inherited.or_else(|| window.focused(cx).map(|focus| focus.downgrade()));
        self.host.0.borrow_mut().active = Some(cx.entity().downgrade());
        self.install_guards(window, cx);
        window.focus(&self.focus, cx);
        self.host.notify(window, cx);

        true
    }

    /// Apply interaction availability immediately, before the next render.
    /// Keep [`super::Dialog::availability`] synchronized with the operation's retained state.
    pub fn set_availability(&mut self, availability: DialogAvailability, cx: &mut Context<Self>) {
        if self.availability != availability {
            self.availability = availability;
            cx.notify();
        }
    }

    /// Close an open dialog, including while busy, and restore its mounted opener or host fallback.
    /// Returns false when already closed. Application work is never cancelled by this method.
    ///
    /// # Panics
    /// Panics when used in a different window from the host.
    pub fn close(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) -> bool {
        self.host.bind(window);

        self.close_inner(true, window, cx)
    }

    fn close_inner(
        &mut self,
        restore: bool,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.open {
            return false;
        }

        self.open = false;
        self.needs_focus = false;
        self.bounds = None;
        self.subscriptions.clear();
        self.host.0.borrow_mut().active = None;
        let target = self
            .return_focus
            .take()
            .and_then(|focus| focus.upgrade())
            .filter(|focus| {
                self.host.root().contains(focus, window) && !self.focus.contains(focus, window)
            });

        if restore {
            if let Some(target) = target {
                window.focus(&target, cx);
            } else if self.host.root().contains(&self.host.fallback(), window) {
                window.focus(&self.host.fallback(), cx);
            } else {
                window.blur();
            }
        }

        cx.emit(DialogEvent::Closed);
        self.host.notify(window, cx);

        true
    }

    /// Whether this dialog is open. Retained form state belongs to the application.
    #[must_use]
    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Most recently painted panel bounds, absent while closed or before its first paint.
    #[must_use]
    pub fn bounds(&self) -> Option<gpui::Bounds<gpui::Pixels>> {
        self.bounds
    }

    pub(super) fn mounted(&mut self, bounds: gpui::Bounds<gpui::Pixels>) {
        self.bounds = Some(bounds);
        self.frame = self.host.0.borrow().frame;
    }

    pub(super) fn dismiss(
        &mut self,
        outside: bool,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        if self.availability == DialogAvailability::Busy
            || self.dismissal == DialogDismissal::Explicit
        {
            return;
        }

        if !outside || self.dismissal == DialogDismissal::EscapeAndOutside {
            self.close(window, cx);
        }
    }

    pub(super) fn focus_first(&self, window: &mut gpui::Window, cx: &mut gpui::App) {
        window.focus(&self.first, cx);
        window.focus_next(cx);

        if self.last.is_focused(window) || !self.focus.contains_focused(window, cx) {
            window.focus(&self.focus, cx);
        }
    }

    fn focus_initial(&self, window: &mut gpui::Window, cx: &mut gpui::App) {
        if let Some(target) = &self.initial_focus
            && self.focus.contains(target, window)
        {
            window.focus(target, cx);
        } else {
            self.focus_first(window, cx);
        }
    }

    pub(super) fn navigate(&self, backwards: bool, window: &mut gpui::Window, cx: &mut gpui::App) {
        if backwards {
            if self.focus.is_focused(window) {
                window.focus(&self.last, cx);
            }

            window.focus_prev(cx);
        } else {
            if self.focus.is_focused(window) {
                window.focus(&self.first, cx);
            }

            window.focus_next(cx);
        }

        if self.first.is_focused(window) {
            window.focus(&self.last, cx);
            window.focus_prev(cx);
        } else if self.last.is_focused(window) {
            window.focus(&self.first, cx);
            window.focus_next(cx);
        }

        if self.first.is_focused(window)
            || self.last.is_focused(window)
            || !self.focus.contains_focused(window, cx)
        {
            window.focus(&self.focus, cx);
        }
    }

    fn install_guards(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let focus = self.focus.clone();

        self.subscriptions
            .push(cx.on_focus_out(&focus, window, |this, _, window, cx| {
                // Audit after paint so a newly opened child menu has established focus ancestry.
                if this.open {
                    this.host.notify(window, cx);
                }
            }));

        for (sentinel, backwards) in [(self.first.clone(), true), (self.last.clone(), false)] {
            let weak = cx.weak_entity();

            self.subscriptions.push(window.on_focus_in(
                &sentinel.clone(),
                cx,
                move |window, cx| {
                    if !sentinel.is_focused(window) {
                        return;
                    }

                    let _ = weak.update(cx, |this, cx| {
                        if this.open {
                            this.navigate(backwards, window, cx);
                        }
                    });
                },
            ));
        }
    }
}
