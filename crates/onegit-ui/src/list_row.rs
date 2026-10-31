use crate::motion::{self, Surface};
use crate::{ControlState, PressHandler, Text, TextRole, TextTone, Theme, focusable};
use rake::gpui::{self, AnyElement, ColorExt, ElementId, SharedString, prelude::*, px};

/// Persistent selection, independent of hover, keyboard focus and checkbox inclusion.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RowSelection {
    /// Ordinary row.
    #[default]
    Unselected,
    /// Selected row.
    Selected,
}

/// Row geometry for content lists or attached menus.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ListRowVariant {
    /// Standard content-list slots and button padding.
    #[default]
    Standard,
    /// Menu rows with eight-pixel insets and slot gaps; slots are decorative.
    Menu,
    /// Forty-pixel single-choice form row with an outlined selected state.
    Choice,
}

/// Composable list row; interactive slots are siblings of the main action.
///
/// With the standard variant, a checkbox in `leading` or `trailing` stays outside
/// the row's button. Menu slots must be decorative; the whole row is one button.
/// Its controlled value can therefore remain independent of the viewed row.
#[derive(IntoElement)]
pub struct ListRow {
    /// Stable identity, normally derived from the row's data key.
    pub id: ElementId,
    /// Main readable row label.
    pub label: SharedString,
    /// Accessible name when navigation context differs from the visible label.
    pub accessibility_label: Option<SharedString>,
    /// Optional secondary line.
    pub description: Option<SharedString>,
    /// Optional leading glyph/control.
    pub leading: Option<AnyElement>,
    /// Optional trailing metadata/control.
    pub trailing: Option<AnyElement>,
    /// Persistent viewed-row state.
    pub selection: RowSelection,
    /// Content-list or attached-menu geometry.
    pub variant: ListRowVariant,
    /// Availability of the main action; slot controls keep their own state.
    pub state: ControlState,
    /// Activates the viewed row, independently of slot controls.
    pub on_press: Option<PressHandler>,
}

impl ListRow {
    /// Create a selectable row without slots or secondary text.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            accessibility_label: None,
            description: None,
            leading: None,
            trailing: None,
            selection: RowSelection::Unselected,
            variant: ListRowVariant::Standard,
            state: ControlState::Enabled,
            on_press: None,
        }
    }
}

impl std::fmt::Debug for ListRow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ListRow")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("selection", &self.selection)
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for ListRow {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        let theme = Theme::current();
        let selected = self.selection == RowSelection::Selected;
        let enabled = self.state.is_interactive();
        let menu = self.variant != ListRowVariant::Standard;
        let choice = self.variant == ListRowVariant::Choice;
        let description = self.description.clone().unwrap_or_default();

        let rest = Surface::new(if selected {
            theme.selection
        } else {
            Theme::transparent()
        });

        let hover = Surface::new(if selected {
            theme.selection.blend(&theme.hover.opacity(0.4))
        } else {
            theme.hover
        });

        // Slots remain independently interactive even when the main action is disabled.
        motion::surface(self.id.clone(), rest, hover, hover, true, move |paint| {
            if menu {
                return rake::view! {
                    <button id={self.id} disabled={!enabled}
                        aria-label={self.accessibility_label.unwrap_or_else(||self.label.clone())}
                        aria-description={description}
                        class="flex flex-row items-center gap-2 px-2 py-1 rounded-control min-w-0 w-full text-left"
                        style={|s| focusable(s).min_h(px(if choice {40.} else {28.})).bg(paint.background)
                            .border_color(Theme::transparent()).when(choice,|s|s.px(px(12.)).border_1().border_color(if selected{theme.focus_ring}else{theme.line})).aria_selected(selected)
                            .when(!enabled,|s|s.opacity(0.5))}
                        on:click={move |event,window,cx| {
                            cx.stop_propagation();
                            if let Some(handler)=&self.on_press {handler(event,window,cx);}
                        }}>
                        if let Some(leading)=self.leading { {leading} }
                        <div class="flex flex-col flex-1 min-w-0">
                            <Text role={if choice{TextRole::Small}else{TextRole::Body}} max_lines={Some(1)} {..Text::new("label",self.label)}/>
                            if let Some(description)=self.description {
                                <Text role={TextRole::Caption} tone={TextTone::Muted} max_lines={Some(1)}
                                    {..Text::new("description",description)}/>
                            }
                        </div>
                        if let Some(trailing)=self.trailing { {trailing} }
                    </button>
                }.into_any_element();
            }

            rake::view! {
                <div id={self.id} class="flex flex-row items-center gap-1 px-1 rounded-control min-w-0"
                    style={|s| s.bg(paint.background)}>
                    if let Some(leading)=self.leading { {leading} }
                    <button id="action" disabled={!enabled} aria-label={self.accessibility_label.unwrap_or_else(||self.label.clone())}
                        aria-description={description}
                        class="flex flex-col items-start justify-center flex-1 min-w-0 text-left px-1.5 py-1"
                        style={|s| focusable(s).min_h(px(28.)).border_color(Theme::transparent())
                            .aria_selected(selected).when(!enabled,|s|s.opacity(0.5))}
                        on:click={move |event,window,cx| {
                            cx.stop_propagation();
                            if let Some(handler)=&self.on_press {handler(event,window,cx);}
                        }}>
                        <Text max_lines={Some(1)} {..Text::new("label",self.label)}/>
                        if let Some(description)=self.description {
                            <Text role={TextRole::Caption} tone={TextTone::Muted} max_lines={Some(1)}
                                {..Text::new("description",description)}/>
                        }
                    </button>
                    if let Some(trailing)=self.trailing { {trailing} }
                </div>
            }.into_any_element()
        })
    }
}
