//! Reusable, native 1git controls composed with `rake::view!`.
//!
//! Install a [`Theme`] once on the UI thread before constructing views. Components
//! own presentation values; callers own application state, callbacks and stable IDs.
//! No component reads Git or persists user preferences.

#![doc = include_str!("../README.md")]

mod button;
mod checkbox;
mod commit_list;
mod commit_subject;
mod dialog;
mod diff_viewer;
mod dropdown_menu;
mod icon;
mod input;
mod list_row;
mod motion;
mod overlay;
mod pane;
mod resizable_split;
mod retained;
mod tabs;
mod text;
mod theme;
mod toast;
mod tooltip;

pub use button::{
    Button, ButtonTone, ButtonVariant, ControlSize, ControlState, IconButton, PressHandler,
};

pub use commit_subject::CommitSubject;

pub use checkbox::{CheckHandler, CheckState, Checkbox};

pub use dialog::{
    Dialog, DialogAvailability, DialogDismissal, DialogEvent, DialogHost, DialogHostState,
    DialogKind, DialogState,
};

pub use commit_list::{
    CommitItem, CommitList, CommitListData, CommitListDataError, CommitListDensity,
    CommitListState, CommitRef, CommitRefKind, CommitSelectionHandler, CommitStatus,
};

pub use diff_viewer::{
    DiffDocument, DiffGutterStyle, DiffLine, DiffLineKind, DiffParseError, DiffView, DiffViewer,
    DiffViewerState,
};

pub use dropdown_menu::{DropdownMenu, MenuAlignment, MenuEntry, MenuHandler, MenuItem};
pub use icon::{Icon, IconName, IconSize};

pub use input::{
    InputAvailability, InputEvent, InputState, InputValidation, InputVariant, SearchField,
    TextArea, TextInput,
};

pub use list_row::{ListRow, RowSelection};
pub use pane::{Pane, PanePadding};
pub use resizable_split::{ResizableSplit, SplitAxis, SplitEvent, SplitState};
pub use tabs::{TabHandler, TabItem, TabVariant, Tabs};
pub use text::{Text, TextRole, TextTone};
pub use theme::{Appearance, Theme};

pub use toast::{
    Toast, ToastAction, ToastActionHandler, ToastHost, ToastId, ToastKind, ToastLifetime,
    ToastState,
};

pub use tooltip::Tooltip;

rake::theme!(Theme);

/// Shared control outline; keyboard focus stays visible independently of selection.
#[rake::style("border-1 rounded-control focus-visible:border-focus-ring")]
pub(crate) fn focusable();
