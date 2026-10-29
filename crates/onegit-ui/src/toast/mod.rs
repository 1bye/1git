//! Bounded window notifications with application-owned operations and native live regions.
mod host;
mod motion;
mod state;

pub use host::ToastHost;
use rake::gpui::{self, SharedString};
pub use state::{ToastId, ToastState};
use std::time::Duration;

/// Notification meaning; progress is indeterminate and never claims a completion percentage.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToastKind {
    /// An operation completed successfully.
    Success,
    /// An operation failed and may offer a recovery action.
    Error,
    /// An operation is in progress; applications update the same toast when it finishes.
    Progress,
}

/// Expiration policy, paused during user interaction, inactive windows and modal dialogs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToastLifetime {
    /// Remain until explicitly dismissed, updated or displaced by newer notifications.
    Persistent,
    /// Expire after this much active, uninterrupted display time.
    Timed(Duration),
}

/// Application-owned recovery callback, invoked after its notification is removed.
pub type ToastActionHandler = Box<dyn Fn(&mut gpui::Window, &mut gpui::App)>;

/// Optional recovery action. The toast is removed before the callback runs.
pub struct ToastAction {
    /// Visible and accessible action label.
    pub label: SharedString,
    /// Application-owned callback; it may publish another toast.
    pub on_press: ToastActionHandler,
}

impl ToastAction {
    /// Create a labeled action; callbacks never run on expiration or dismissal.
    #[must_use]
    pub fn new(
        label: impl Into<SharedString>,
        handler: impl Fn(&mut gpui::Window, &mut gpui::App) + 'static,
    ) -> Self {
        Self {
            label: label.into(),
            on_press: Box::new(handler),
        }
    }
}

impl std::fmt::Debug for ToastAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToastAction")
            .field("label", &self.label)
            .finish_non_exhaustive()
    }
}

/// Reusable notification content. Publish through [`ToastState::show`] and update by [`ToastId`].
#[derive(Debug)]
pub struct Toast {
    /// Success, error or progress presentation and announcement semantics.
    pub kind: ToastKind,
    /// Short primary message, retained in full for assistive technology.
    pub title: SharedString,
    /// Optional supporting context; long messages are visually limited to three lines.
    pub description: Option<SharedString>,
    /// Optional action, independent of the dismiss button.
    pub action: Option<ToastAction>,
    /// Success defaults to five seconds; error and progress default to persistent.
    pub lifetime: ToastLifetime,
}

impl Toast {
    /// Create notification content with a sensible lifetime for its kind.
    #[must_use]
    pub fn new(kind: ToastKind, title: impl Into<SharedString>) -> Self {
        Self {
            kind,
            title: title.into(),
            description: None,
            action: None,
            lifetime: if kind == ToastKind::Success {
                ToastLifetime::Timed(Duration::from_secs(5))
            } else {
                ToastLifetime::Persistent
            },
        }
    }
}
