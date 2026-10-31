//! Retained native editing shared by the three field presentations.
mod buffer;
mod element;
mod ime;
mod state;

pub use state::{InputEvent, InputState};

use crate::{ControlSize, Text, TextRole, TextTone, Theme};
use rake::gpui::{self, ElementId, Entity, Focusable, SharedString, prelude::*};
use std::rc::Rc;

/// Whether native editing is available; read-only fields remain selectable.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InputAvailability {
    /// Editable, selectable and included in keyboard navigation.
    #[default]
    Enabled,
    /// Selectable and copyable, with editing disabled.
    ReadOnly,
    /// Unavailable and skipped by sequential keyboard navigation.
    Disabled,
}

/// Validation supplied by the application; controls do not validate business rules.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum InputValidation {
    /// No error is shown.
    #[default]
    Valid,
    /// Error text is visible and announced as part of the field description.
    Invalid(SharedString),
}

/// Field presentation without changing native editing or accessibility behavior.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InputVariant {
    /// Bordered control with its own inset background.
    #[default]
    Outlined,
    /// Transparent editor for compact toolbars and integrated commit composers.
    Plain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Text,
    Search,
    Multiline,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Config {
    kind: Kind,
    label: SharedString,
    placeholder: SharedString,
    description: SharedString,
    availability: InputAvailability,
    variant: InputVariant,
    validation: InputValidation,
    size: ControlSize,
    rows: u16,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            kind: Kind::Text,
            label: "Text".into(),
            placeholder: "".into(),
            description: "".into(),
            availability: InputAvailability::Enabled,
            variant: InputVariant::Outlined,
            validation: InputValidation::Valid,
            size: ControlSize::Medium,
            rows: 5,
        }
    }
}

macro_rules! field_rows {
    ($this:ident, $row:ident) => {
        $this.$row.max(1)
    };
    ($this:ident) => {
        1
    };
}

macro_rules! field {
    ($name:ident, $kind:ident, $doc:literal $(,$row:ident)?) => {
        #[doc=$doc]
        #[derive(Debug, IntoElement)]
        pub struct $name {
            /// Stable identity of the field and its supporting text.
            pub id: ElementId,
            /// Caller-owned editing state; retain one entity per logical field.
            pub state: Entity<InputState>,
            /// Required accessible name, also shown above the field by default.
            pub label: SharedString,
            /// Whether the label is visible; its accessible name is always retained.
            pub show_label: bool,
            /// Hint displayed while the value is empty.
            pub placeholder: SharedString,
            /// Supporting text, independent of validation.
            pub description: Option<SharedString>,
            /// Editing and focus availability.
            pub availability: InputAvailability,
            /// Outlined field or borderless editor integrated into its parent.
            pub variant: InputVariant,
            /// Application-supplied validation message.
            pub validation: InputValidation,
            /// Compact control geometry; multiline fields use its padding.
            pub size: ControlSize,
            $(/// Visible multiline rows, clamped to at least one.
            pub $row: u16,)?
        }
        impl $name {
            /// Create a field over retained state. Never create that state during rendering.
            #[must_use]
            pub fn new(id:impl Into<ElementId>, state:&Entity<InputState>, label:impl Into<SharedString>) -> Self {
                Self {id:id.into(),state:state.clone(),label:label.into(),show_label:true,placeholder:"".into(),
                    description:None,availability:InputAvailability::Enabled,variant:InputVariant::Outlined,validation:InputValidation::Valid,
                    size:ControlSize::Medium,$($row:5,)?}
            }
        }
        impl RenderOnce for $name {
            fn render(self, _: &mut gpui::Window, cx:&mut gpui::App) -> impl IntoElement {
                let description=self.description.clone().unwrap_or_default();
                let config=Config {kind:Kind::$kind,label:self.label.clone(),placeholder:self.placeholder,
                    description,availability:self.availability,variant:self.variant,validation:self.validation.clone(),size:self.size,rows:field_rows!(self $(,$row)?)};
                let theme=Theme::current();
                self.state.update(cx,|state,cx|state.configure(config,theme,cx));
                let focus=self.state.read(cx).focus_handle(cx);
                let available=self.availability!=InputAvailability::Disabled;
                rake::view! {
                    <div id={self.id} class="flex flex-col gap-1 min-w-0">
                        if self.show_label {
                            <div on:click={move |_,window,cx| {if available {window.focus(&focus,cx);}}}>
                                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("label",self.label)}/>
                            </div>
                        }
                        {self.state}
                        if let Some(description)=self.description {
                            <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("help",description)}/>
                        }
                        if let InputValidation::Invalid(message)=self.validation {
                            <Text role={TextRole::Caption} tone={TextTone::Danger} {..Text::new("error",message)}/>
                        }
                    </div>
                }
            }
        }
    };
}

field!(
    TextInput,
    Text,
    "A themed single-line native text editor with application-owned editing state."
);

field!(
    SearchField,
    Search,
    "A single-line search editor with a clear action and Escape-to-clear behavior."
);

field!(
    TextArea,
    Multiline,
    "A multiline native editor with soft wrapping, selection and scrolling.",
    rows
);

fn same_theme(left: &Rc<Theme>, right: &Rc<Theme>) -> bool {
    Rc::ptr_eq(left, right)
}
