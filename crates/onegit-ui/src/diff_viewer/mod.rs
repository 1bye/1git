//! Virtualized read-only diff rows; immutable documents are prepared outside render.
mod document;
mod rows;
mod state;
mod words;

use crate::{Text, TextRole, TextTone, Theme, focusable};
pub use document::{DiffDocument, DiffLine, DiffLineKind, DiffParseError, DiffView};
use rake::gpui::{self, accesskit, prelude::*, px};

/// Placement and highlighting of the line-number gutters.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DiffGutterStyle {
    /// Highlight the full row, including its line numbers.
    #[default]
    Continuous,
    /// Reserve 36 pixels before neutral line numbers, matching a host's inclusion column.
    Inset,
}

/// Read-only diff surface. Give its parent a bounded height; retain its immutable document outside render.
#[derive(Debug, IntoElement)]
pub struct DiffViewer {
    /// Stable identity retaining scroll and keyboard focus across rerenders/view switches.
    pub id: gpui::ElementId,
    /// Accessible name and visible file/context title. Path decoding belongs to the application.
    pub label: gpui::SharedString,
    /// Validated, immutable single-file patch, cheaply cloned for rendering.
    pub document: DiffDocument,
    /// Controlled unified or side-by-side presentation.
    pub view: DiffView,
    /// Show the default title/count header and surface; disable when the host supplies both.
    pub show_header: bool,
    /// Line-number presentation; inset gutters align with working-tree inclusion controls.
    pub gutter_style: DiffGutterStyle,
}

impl DiffViewer {
    /// Create a unified viewer for an already parsed patch.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        label: impl Into<gpui::SharedString>,
        document: DiffDocument,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            document,
            view: DiffView::Unified,
            show_header: true,
            gutter_style: DiffGutterStyle::Continuous,
        }
    }
}

impl RenderOnce for DiffViewer {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| {
            state::Scroll::new(self.document.clone(), self.view, cx)
        });

        state.update(cx, |state, _| {
            state.configure(self.document.clone(), self.view)
        });
        let theme = Theme::current();
        let font_size = theme.code.size;
        let font = gpui::font(theme.mono);
        let font_id = window.text_system().resolve_font(&font);

        let advance = window
            .text_system()
            .em_advance(font_id, font_size)
            .unwrap_or(font_size)
            .max(px(1.));

        let gutter = (advance * self.document.digits() as f32 + px(14.)).max(px(30.));

        let width = advance * self.document.columns() as f32
            + gutter
                * if self.view == DiffView::Unified {
                    2.
                } else {
                    1.
                }
            + px(84.);

        let focus = state
            .read(cx)
            .focus
            .clone()
            .tab_stop(!self.document.lines().is_empty());

        let keyboard = state.clone();
        let pointer_focus = focus.clone();

        let summary = if self.document.is_binary() {
            "Binary change".to_owned()
        } else {
            format!(
                "+{} −{}",
                self.document.added_lines(),
                self.document.deleted_lines()
            )
        };

        let content = if self.document.lines().is_empty() {
            rake::view! {<div class="p-3"><Text tone={TextTone::Muted} {..Text::new("empty", "No changes to display.")}/></div>}.into_any_element()
        } else {
            let left = rows::list(
                &state,
                self.document.clone(),
                rows::Layout {
                    view: self.view,
                    side: rows::Side::Old,
                    gutter,
                    width,
                    style: self.gutter_style,
                },
                cx,
            );

            if self.view == DiffView::Unified {
                left
            } else {
                // Equal row heights and width budgets give both columns the same scroll extent.
                let right = rows::list(
                    &state,
                    self.document.clone(),
                    rows::Layout {
                        view: self.view,
                        side: rows::Side::New,
                        gutter,
                        width,
                        style: self.gutter_style,
                    },
                    cx,
                );

                rake::view! {
                    <div class="flex flex-row flex-1 min-w-0 min-h-0">
                        <div class="flex flex-col flex-1 min-w-0 min-h-0">
                            <div class="px-3 py-1 border-b-1 border-line"><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("before", "Before")}/></div>
                            {left}
                        </div>
                        <div class="w-[1px] bg-line shrink-0"/>
                        <div class="flex flex-col flex-1 min-w-0 min-h-0">
                            <div class="px-3 py-1 border-b-1 border-line"><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("after", "After")}/></div>
                            {right}
                        </div>
                    </div>
                }.into_any_element()
            }
        };

        rake::view! {
            <div id={self.id} role={accesskit::Role::Group} aria-label={self.label.clone()}
                class="size-full flex flex-col min-w-0 min-h-0 text-ink overflow-hidden"
                style={|s| focusable(s).bg(if self.show_header { theme.surface } else { Theme::transparent() }).border_color(Theme::transparent()).track_focus(&focus).on_mouse_down(gpui::MouseButton::Left, move |_, window, cx| window.focus(&pointer_focus, cx)).on_key_down(move |event, window, cx| keyboard.update(cx, |state, cx| state.key(event, window, cx)))}>
                if self.show_header {<div class="h-[36px] flex flex-row items-center justify-between gap-3 px-3.5 border-b-1 border-hairline bg-surface shrink-0">
                    <div class="flex-1 min-w-0"><Text max_lines={Some(1)} role={TextRole::Caption} {..Text::new("title", self.label)}/></div>
                    <div class="shrink-0"><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("summary", summary)}/></div>
                </div>}
                {content}
            </div>
        }
    }
}
