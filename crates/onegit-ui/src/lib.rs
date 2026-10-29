//! Reusable, native 1git controls composed with `rake::view!`.
//!
//! Install a [`Theme`] once on the UI thread before constructing views. Components
//! own presentation values; callers own application state, callbacks and stable IDs.
//! No component reads Git, starts tasks or persists user preferences.

#![doc = include_str!("../README.md")]

mod button;
mod checkbox;
mod icon;
mod input;
mod list_row;
mod motion;
mod pane;
mod text;
mod theme;

pub use button::{
    Button, ButtonTone, ButtonVariant, ControlSize, ControlState, IconButton, PressHandler,
};
pub use checkbox::{CheckHandler, CheckState, Checkbox};
pub use icon::{Icon, IconName, IconSize};
pub use input::{
    InputAvailability, InputEvent, InputState, InputValidation, SearchField, TextArea, TextInput,
};
pub use list_row::{ListRow, RowSelection};
pub use pane::{Pane, PanePadding};
pub use text::{Text, TextRole, TextTone};
pub use theme::{Appearance, Theme};

rake::theme!(Theme);

/// Shared control outline; keyboard focus stays visible independently of selection.
#[rake::style("border-1 rounded-control focus-visible:border-focus-ring")]
pub(crate) fn focusable();
