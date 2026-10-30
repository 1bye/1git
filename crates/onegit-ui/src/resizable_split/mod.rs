//! Two bounded panes with immediate pointer resizing and an accessible keyboard divider.
mod state;
mod surface;

use rake::gpui::{self, prelude::*, px};
pub use state::{SplitEvent, SplitState};

/// Direction in which pane contents are arranged.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SplitAxis {
    /// Side-by-side panes and a vertical divider.
    #[default]
    Horizontal,
    /// Stacked panes and a horizontal divider.
    Vertical,
}

impl SplitAxis {
    pub(super) fn length(self, size: gpui::Size<gpui::Pixels>) -> gpui::Pixels {
        match self {
            Self::Horizontal => size.width,
            Self::Vertical => size.height,
        }
    }

    pub(super) fn coordinate(self, point: gpui::Point<gpui::Pixels>) -> gpui::Pixels {
        match self {
            Self::Horizontal => point.x,
            Self::Vertical => point.y,
        }
    }
}

/// Two arbitrary pane slots sharing a retained size. Supply a bounded parent size.
#[derive(IntoElement)]
pub struct ResizableSplit {
    /// Stable component identity.
    pub id: gpui::ElementId,
    /// State retained by the window owner, including the preferred first-pane size.
    pub state: gpui::Entity<SplitState>,
    /// Accessible name describing the resized region, such as "Repository sidebar width".
    pub label: gpui::SharedString,
    /// Side-by-side or stacked layout.
    pub axis: SplitAxis,
    /// Minimum first-pane size in logical pixels.
    pub min_first: gpui::Pixels,
    /// Minimum second-pane size in logical pixels.
    pub min_second: gpui::Pixels,
    /// Disable pointer, keyboard and accessibility resizing.
    pub disabled: bool,
    /// Leading or upper pane.
    pub first: gpui::AnyElement,
    /// Trailing or lower pane.
    pub second: gpui::AnyElement,
}

impl ResizableSplit {
    /// Create a horizontal split with 120-pixel minimums; replace `first` and `second` with content.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        state: &gpui::Entity<SplitState>,
        label: impl Into<gpui::SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            state: state.clone(),
            label: label.into(),
            axis: SplitAxis::Horizontal,
            min_first: px(120.),
            min_second: px(120.),
            disabled: false,
            first: gpui::Empty.into_any_element(),
            second: gpui::Empty.into_any_element(),
        }
    }
}

impl std::fmt::Debug for ResizableSplit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResizableSplit")
            .field("id", &self.id)
            .field("axis", &self.axis)
            .field("min_first", &self.min_first)
            .field("min_second", &self.min_second)
            .field("disabled", &self.disabled)
            .finish_non_exhaustive()
    }
}

struct Mount {
    _subscription: gpui::Subscription,
}

impl RenderOnce for ResizableSplit {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = self.state.clone();

        let mount = window.use_keyed_state(self.id.clone(), cx, move |window, cx| {
            let window = window.window_handle();
            let weak = state.downgrade();
            let id = cx.entity_id();

            cx.on_release(move |_: &mut Mount, cx| {
                let _ = window.update(cx, |_, window, cx| {
                    let _ = weak.update(cx, |state, cx| state.unmount(id, window, cx));
                });
            })
            .detach();

            Mount {
                _subscription: cx.observe(&state, |_, _, cx| cx.notify()),
            }
        });

        self.state.update(cx, |state, cx| {
            state.configure(
                state::Config {
                    axis: self.axis,
                    min_first: self.min_first,
                    min_second: self.min_second,
                    disabled: self.disabled,
                    mount: mount.entity_id(),
                },
                window,
                cx,
            )
        });

        gpui::div()
            .id(self.id.clone())
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .child(surface::SplitSurface::new(self))
    }
}
