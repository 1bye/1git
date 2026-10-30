//! Virtualized, controlled history selection using immutable presentation data.
mod data;
mod state;

use crate::{
    Text, TextRole, TextTone, Theme, focusable,
    motion::{self, Surface},
};

pub use data::{CommitItem, CommitListData, CommitListDataError, CommitRef, CommitRefKind};
use rake::gpui::{self, ColorExt, accesskit, prelude::*, px};
use std::rc::Rc;

/// Request a commit selection; the owner updates `selected` and the corresponding preview.
pub type CommitSelectionHandler =
    Box<dyn Fn(&gpui::SharedString, &mut gpui::Window, &mut gpui::App)>;

/// Fixed two-line row geometry, independent of selection behavior.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CommitListDensity {
    /// 48-pixel rows for repository sidebars.
    #[default]
    Compact,
    /// 60-pixel rows with more vertical breathing room.
    Comfortable,
}

impl CommitListDensity {
    fn height(self) -> f32 {
        match self {
            Self::Compact => 48.,
            Self::Comfortable => 60.,
        }
    }
}

/// A read-only commit list. Supply a bounded parent height and retain its data snapshot outside render.
#[derive(IntoElement)]
pub struct CommitList {
    /// Stable identity retaining focus and scrolling.
    pub id: gpui::ElementId,
    /// Accessible list name.
    pub label: gpui::SharedString,
    /// Cheaply cloned immutable entries, in the desired display order.
    pub data: CommitListData,
    /// Caller-controlled selected ID; absent or missing IDs select no entry.
    pub selected: Option<gpui::SharedString>,
    /// Compact or comfortable two-line rows.
    pub density: CommitListDensity,
    /// Visible text when the snapshot is empty.
    pub empty_message: gpui::SharedString,
    /// Called once per request for an ID different from `selected`.
    pub on_select: Option<CommitSelectionHandler>,
}

impl CommitList {
    /// Construct a compact list without an implicit selection.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        label: impl Into<gpui::SharedString>,
        data: CommitListData,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            data,
            selected: None,
            density: CommitListDensity::default(),
            empty_message: "No commits to display.".into(),
            on_select: None,
        }
    }
}

impl std::fmt::Debug for CommitList {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CommitList")
            .field("id", &self.id)
            .field("data", &self.data)
            .field("selected", &self.selected)
            .field("density", &self.density)
            .finish_non_exhaustive()
    }
}

fn describe(item: &CommitItem) -> String {
    let mut text = item.summary.to_string();

    for value in [&item.author, &item.date, &item.hash].into_iter().flatten() {
        text.push_str(", ");
        text.push_str(value);
    }

    for reference in &item.references {
        text.push_str(", ");
        text.push_str(match reference.kind {
            CommitRefKind::Branch => "Branch ",
            CommitRefKind::Remote => "Remote ",
            CommitRefKind::Tag => "Tag ",
        });
        text.push_str(&reference.label);
    }

    text
}

impl RenderOnce for CommitList {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| state::ListFocus::new(cx));
        let selected = self.selected.filter(|id| self.data.find(id).is_some());

        state.update(cx, |state, _| {
            state.reconcile(self.data.clone(), selected.clone(), self.density)
        });
        let theme = Theme::current();

        let focus = state
            .read(cx)
            .focus
            .clone()
            .tab_stop(!self.data.items().is_empty());

        let pointer_focus = focus.clone();
        let focused = focus.is_focused(window);
        let cursor = state.read(cx).cursor.clone();
        let scroll = state.read(cx).scroll.clone();
        let handler = self.on_select.map(Rc::new);
        let key_handler = handler.clone();
        let key_selected = selected.clone();
        let keyboard = state.clone();
        let density = self.density;
        let count = self.data.items().len();

        let content = if count == 0 {
            rake::view! {<div class="p-3"><Text tone={TextTone::Muted} {..Text::new("empty",self.empty_message)}/></div>}.into_any_element()
        } else {
            gpui::uniform_list("commits",count,move |range,_,_| {
                range.map(|index| {
                    let item=self.data.items()[index].clone();
                    let active=cursor.as_ref()==Some(&item.id);
                    let is_selected=selected.as_ref()==Some(&item.id);
                    let theme=Theme::current();
                    let background=if is_selected {theme.selection} else {theme.surface};
                    let rest=Surface::new(background);
                    let hover=Surface::new(background.blend(&theme.hover.opacity(if is_selected {0.4} else {1.})));
                    let state=state.clone();
                    let handler=handler.clone();
                    let focus=focus.clone();
                    let description=describe(&item);
                    let author_date=[item.author.as_deref(),item.date.as_deref()].into_iter().flatten().collect::<Vec<_>>().join(" · ");

                    motion::surface(item.id.clone().into(),rest,hover,hover,true,move |paint| {
                        rake::view! {
                            <div id="row" role={accesskit::Role::ListBoxOption} aria-label={description}
                                class="w-full min-w-0 flex flex-col justify-center gap-0.5 px-3 py-1 border-1 overflow-hidden"
                                style={|s| s.h(px(density.height())).bg(paint.background).border_color(if active && focused {theme.focus_ring} else {Theme::transparent()})
                                    .aria_selected(is_selected).when(active,|s| s.aria_active_descendant()).cursor(gpui::CursorStyle::PointingHand)
                                    .debug_selector(||format!("commit-row-{}",item.id))
                                    .a11y_synthetic_children(move |builder| {builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(count);})}
                                on:click={move |_,window,cx| {
                                    cx.stop_propagation();window.focus(&focus,cx);
                                    state.update(cx,|state,cx|state.choose(&item.id,cx));
                                    if !is_selected && let Some(handler)=&handler {handler(&item.id,window,cx);}
                                }}>
                                <div class="flex flex-row items-center gap-2 min-w-0">
                                    <div class="flex-1 min-w-0"><Text max_lines={Some(1)} {..Text::new("subject",item.summary.clone())}/></div>
                                    <div class="flex flex-row gap-1 shrink-0 min-w-0 overflow-hidden" style={|s| s.max_w(gpui::relative(0.5))}>
                                        for (index,reference) in item.references.iter().take(2).enumerate() {
                                            <div id={("ref",index)} class="rounded-[3px] px-1 text-caption min-w-0" style={|s| {
                                                let ink=match reference.kind {CommitRefKind::Branch=>theme.accent,CommitRefKind::Remote=>theme.muted_ink,CommitRefKind::Tag=>theme.warning};
                                                s.max_w(px(72.)).bg(ink.opacity(0.1)).text_color(ink)
                                            }}><p wrap={false} ellipsis={true}>{reference.label.clone()}</p></div>
                                        }
                                        if item.references.len()>2 {<Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("more-refs",format!("+{}",item.references.len()-2))}/>}
                                    </div>
                                </div>
                                <div class="flex flex-row items-center gap-2 min-w-0">
                                    <div class="flex-1 min-w-0"><Text max_lines={Some(1)} role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("author-date",author_date)}/></div>
                                    if let Some(hash)=&item.hash {<p class="text-caption font-mono text-muted-ink shrink-0" style={|s| s.max_w(px(80.))} wrap={false} ellipsis={true}>{hash.clone()}</p>}
                                </div>
                            </div>
                        }
                    }).into_any_element()
                }).collect()
            }).size_full().min_w_0().min_h_0().track_scroll(&scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto).into_any_element()
        };

        rake::view! {
            <div id={self.id} role={accesskit::Role::ListBox} aria-label={self.label}
                class="size-full min-w-0 min-h-0 bg-surface text-ink overflow-hidden"
                style={|s| focusable(s).border_color(theme.line).track_focus(&pointer_focus).debug_selector(||"commit-list".into())
                    .on_mouse_down(gpui::MouseButton::Left,move |_,window,cx|window.focus(&pointer_focus,cx))
                    .on_key_down(move |event,window,cx| {
                        let id=keyboard.update(cx,|state,cx|state.key(event,window,cx));
                        if let Some(id)=id && Some(&id)!=key_selected.as_ref() && let Some(handler)=&key_handler {handler(&id,window,cx);}
                    })}>
                {content}
            </div>
        }
    }
}
