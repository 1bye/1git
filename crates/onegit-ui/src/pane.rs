use rake::gpui::{self, AnyElement, ElementId, prelude::*, px};

/// Body inset independent of the pane's header/footer spacing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PanePadding {
    /// Edge-to-edge content, for lists and editors.
    None,
    /// Twelve-pixel content inset.
    #[default]
    Standard,
}

/// Native content surface with optional header/footer slots and ordinary children.
#[derive(IntoElement)]
pub struct Pane {
    /// Stable root identity.
    pub id: ElementId,
    /// Optional toolbar or heading, rendered above a separator.
    pub header: Option<AnyElement>,
    /// Body elements, automatically supplied by paired markup tags.
    pub children: Vec<AnyElement>,
    /// Optional actions/status, rendered below a separator.
    pub footer: Option<AnyElement>,
    /// Body inset, supporting edge-to-edge lists and editors.
    pub padding: PanePadding,
}
impl Pane {
    /// Construct an empty, normally padded surface with no header/footer.
    #[must_use]
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            header: None,
            children: Vec::new(),
            footer: None,
            padding: PanePadding::Standard,
        }
    }
}
impl std::fmt::Debug for Pane {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pane")
            .field("id", &self.id)
            .field("children", &self.children.len())
            .field("padding", &self.padding)
            .finish_non_exhaustive()
    }
}
impl RenderOnce for Pane {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        rake::view! {
            <section id={self.id} class="flex flex-col min-w-0 border-1 border-line bg-surface rounded-[8px] overflow-hidden">
                if let Some(header)=self.header {
                    <header class="px-3 py-2 border-b-1 border-line">{header}</header>
                }
                <div class="flex flex-col gap-3 min-w-0"
                    style={|s| s.p(px(if self.padding==PanePadding::Standard {12.} else {0.})).children(self.children)}/>
                if let Some(footer)=self.footer {
                    <footer class="px-3 py-2 border-t-1 border-line">{footer}</footer>
                }
            </section>
        }
    }
}
