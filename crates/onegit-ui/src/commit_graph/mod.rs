//! Virtualized topology, labels and native GPU-painted connections.
mod data;
mod scrollbar;
mod state;

use crate::{
    Appearance, CommitRefKind, CommitSelectionHandler, Theme,
    motion::{self, Surface},
};

use data::Half;
pub use data::{CommitGraphData, GraphCommit};
use rake::gpui::{self, ColorExt as _, accesskit, prelude::*, px};
pub use state::{CommitGraphScroll, CommitGraphState, GraphViewport};
use std::{collections::HashSet, rc::Rc, sync::Arc};

pub(super) const ROW_HEIGHT: f32 = 36.;

fn palette(index: usize) -> gpui::Hsla {
    let colors = if Theme::current().appearance == Appearance::Dark {
        [0xb3a0ff, 0x63d6b2, 0xe9b45f, 0xed8aaa, 0x80b7ec, 0xc6cb79]
    } else {
        [0x7760b5, 0x16876a, 0xb27620, 0xbf5677, 0x377eb5, 0x8b7938]
    };

    gpui::rgb_to_hsla(gpui::rgb(colors[index % colors.len()]))
}

fn lanes(data: &CommitGraphData, index: usize) -> gpui::AnyElement {
    let row = data.row(index).clone();
    let merge = data.commits()[index].parents.len() > 1;

    gpui::canvas(
        |bounds, _, _| bounds,
        move |bounds, _, window, _| {
            let point = |lane: usize, y: f32| {
                bounds.origin + gpui::point(px(10. + lane as f32 * 18.), px(y))
            };

            for edge in &row.edges {
                let (y1, y2) = if edge.half == Half::Top {
                    (0., 18.)
                } else {
                    (18., 36.)
                };

                let middle = (y1 + y2) / 2.;
                let mut path = gpui::PathBuilder::stroke(px(1.7));

                path.move_to(point(edge.from, y1));
                path.cubic_bezier_to(
                    point(edge.to, y2),
                    point(edge.from, middle),
                    point(edge.to, middle),
                );

                if let Ok(path) = path.build() {
                    window.paint_path(path, palette(edge.color));
                }
            }

            let bounds = gpui::Bounds::new(
                point(row.lane, 18.) - gpui::point(px(4.), px(4.)),
                gpui::size(px(8.), px(8.)),
            );

            window.paint_quad(gpui::quad(
                bounds,
                px(4.),
                Theme::current().surface,
                px(if merge { 3. } else { 2. }),
                palette(row.color),
                gpui::BorderStyle::Solid,
            ));
        },
    )
    .w(px(20. + data.lanes() as f32 * 18.))
    .h(px(ROW_HEIGHT))
    .flex_shrink_0()
    .into_any_element()
}

/// Controlled commit graph. Prepare immutable data on a worker and retain its state across tabs.
#[derive(IntoElement)]
pub struct CommitGraph {
    /// Stable native element identity.
    pub id: gpui::ElementId,
    /// Prepared node topology and metadata.
    pub data: CommitGraphData,
    /// Application-owned selected commit identity.
    pub selected: Option<gpui::SharedString>,
    /// Controlled multi-selection, independent from the primary details commit.
    pub selected_ids: Arc<HashSet<gpui::SharedString>>,
    /// Modifier-aware selection; takes precedence over the single-selection callback.
    pub on_select_modified: Option<crate::CommitModifiedSelectionHandler>,
    /// Retained native focus and both scroll axes.
    pub state: gpui::Entity<CommitGraphState>,
    /// Called when a different commit is selected.
    pub on_select: Option<CommitSelectionHandler>,
    /// Optional contextual actions, also available with Shift+F10 on the selected commit.
    pub context_menu: Option<crate::CommitMenuBuilder>,
    /// Status when no rows exist.
    pub empty_message: gpui::SharedString,
}

impl CommitGraph {
    /// Construct a graph without an implicit selection.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        data: CommitGraphData,
        state: &gpui::Entity<CommitGraphState>,
    ) -> Self {
        Self {
            id: id.into(),
            data,
            selected: None,
            selected_ids: Arc::default(),
            on_select_modified: None,
            state: state.clone(),
            on_select: None,
            context_menu: None,
            empty_message: "No commits yet".into(),
        }
    }
}

impl std::fmt::Debug for CommitGraph {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CommitGraph")
            .field("id", &self.id)
            .field("data", &self.data)
            .field("selected", &self.selected)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for CommitGraph {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        if !window.is_window_active() {
            self.state.update(cx, |state, _| state.end_scroll_drag());
        }

        self.state.update(cx, |state, _| {
            state.configure(self.data.clone(), self.selected.clone())
        });
        let focus = self
            .state
            .read(cx)
            .focus
            .clone()
            .tab_stop(!self.data.is_empty());

        let owns = focus.is_focused(window);
        let keyboard_focus = owns && window.last_input_was_keyboard();
        let cursor = self.state.read(cx).cursor.clone();
        let menus = self.context_menu.map(Rc::new);

        let keyboard_menu = menus
            .as_ref()
            .zip(
                self.selected
                    .as_ref()
                    .filter(|id| self.data.position(id).is_some()),
            )
            .map(|(build, id)| build(id));

        let menu_focus = focus.clone();
        let modified = self.on_select_modified.map(Rc::new);
        let key_modified = modified.clone();
        let multiselect = modified.is_some();
        let handler = self.on_select.map(Rc::new);
        let key_handler = handler.clone();
        let key_selected = self.selected.clone();
        let keyboard = self.state.clone();
        let horizontal = self.state.read(cx).horizontal.clone();
        let handle = self.state.read(cx).list.clone();
        let author = window.viewport_size().width >= px(1000.);
        let date = window.viewport_size().width >= px(850.);

        let width = px(20.
            + self.data.lanes() as f32 * 18.
            + 200.
            + 58.
            + if author { 110. } else { 0. }
            + if date { 95. } else { 0. }
            + 32.);

        let count = self.data.len();
        let pointer_focus = focus.clone();
        let row_focus = focus.clone();
        let scroll_state = self.state.clone();

        scrollbar::mount(self.id.clone(), &scroll_state, window, cx);

        let content = if count == 0 {
            gpui::div()
                .p_3()
                .text_color(Theme::current().muted_ink)
                .child(self.empty_message)
                .into_any_element()
        } else {
            gpui::list(handle,move|index,_,_cx|{
                let commit=&self.data.commits()[index];let item=commit.item.clone();let glyph=lanes(&self.data,index);
                let primary=self.selected.as_ref()==Some(&item.id);let selected=if multiselect{self.selected_ids.contains(&item.id)}else{primary};let active=cursor.as_ref()==Some(&item.id);
                let state=self.state.clone();let handler=handler.clone();let modified=modified.clone();let focus=row_focus.clone();
                let theme=Theme::current();

                let description=format!("{} · {} · {} · {} parents · {}",item.summary,item.author.as_deref().unwrap_or(""),item.id,commit.parents.len(),
                    item.references.iter().map(|r|format!("{}: {}",match r.kind{CommitRefKind::Branch=>"Local branch",CommitRefKind::Remote=>"Remote branch",CommitRefKind::Tag=>"Tag"},r.label)).collect::<Vec<_>>().join(", "));

                let refs=item.references.clone();let badges=if refs.first().is_some_and(|r|r.label=="HEAD"){2}else{1};let id=item.id.clone();let labels=refs.iter().map(|reference|if reference.label=="HEAD"{"HEAD · Current commit".to_owned()}else{format!("{}: {}",match reference.kind{CommitRefKind::Branch=>"Local branch",CommitRefKind::Remote=>"Remote branch",CommitRefKind::Tag=>"Tag"},reference.label)}).collect::<Vec<_>>().join("\n");
                let rest=if selected{theme.selection}else{theme.surface};

                let row_id=item.id.clone();

                let row=gpui::div().h(px(ROW_HEIGHT)).px(px(6.)).child(motion::surface(gpui::ElementId::Name(format!("graph-{}",item.id).into()),Surface::new(rest),Surface::new(rest.blend(&theme.hover)),Surface::new(theme.pressed),true,move|surface|{
                    rake::view!{
                        <div id={("row",index)} role={accesskit::Role::ListBoxOption} aria-label={description}
                            class="h-[36px] min-w-0 w-full flex flex-row items-center gap-2 px-2 border-1 rounded-[6px] overflow-hidden"
                            style={|s|s.bg(surface.background).border_color(if active&&keyboard_focus{theme.focus_ring}else{Theme::transparent()}).aria_selected(selected)
                                .when(active&&owns,|s|s.aria_active_descendant()).cursor_pointer().debug_selector(move||format!("graph-row-{index}"))
                                .a11y_synthetic_children(move|builder|{builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(count);})}
                            on:click={move|event:&gpui::ClickEvent,window,cx|{
                                cx.stop_propagation();window.focus(&focus,cx);
                                state.update(cx,|state,cx|{state.cursor=Some(id.clone());cx.notify();});
                                if let Some(handler)=&modified{handler(&crate::CommitSelectionEvent{id:id.clone(),modifiers:event.modifiers()},window,cx);}else if !primary && let Some(handler)=&handler{handler(&id,window,cx);}
                            }}>
                            {glyph}
                            if !refs.is_empty() {
                                <crate::Tooltip max_width={px(560.)} {..crate::Tooltip::new("graph-labels",labels.clone())}>
                                    <button id="labels" tabindex={if selected{0}else{-1}} role={accesskit::Role::Group} aria-label={labels.clone()} class="flex flex-row items-center justify-start p-0 gap-1 overflow-hidden border-1 focus-visible:border-focus-ring" style={|s|s.border_color(Theme::transparent()).max_w(px(if date{400.}else{160.})).min_w(px(if refs.first().is_some_and(|r|r.label=="HEAD"){100.}else{60.}))}>
                                        for (i,reference) in refs.iter().take(badges).enumerate() {
                                            <div id={i} class="px-1.5 rounded-[3px] min-w-0 text-caption" style={|s|s.bg(theme.selection).text_color(match reference.kind {CommitRefKind::Branch=>palette(0),CommitRefKind::Remote=>theme.success,CommitRefKind::Tag=>palette(2)}).when(reference.label=="HEAD",|s|s.flex_shrink_0())}>
                                                <p wrap={false} ellipsis={true}>{format!("{}{}",if reference.kind==CommitRefKind::Tag{"◇ "}else{""},reference.label)}</p>
                                            </div>
                                        }
                                        if refs.len()>badges {<p class="shrink-0 px-1 rounded-[4px] bg-selection text-caption text-muted-ink">{format!("+{}",refs.len()-badges)}</p>}
                                    </button>
                                </crate::Tooltip>
                            }
                            <div class="flex-1 min-w-0"><crate::CommitSubject {..crate::CommitSubject::new("subject",item.summary)}/></div>
                            if author {<div class="w-[110px] shrink-0 min-w-0"><crate::Text role={crate::TextRole::Caption} tone={crate::TextTone::Muted} max_lines={Some(1)} {..crate::Text::new("author",item.author.unwrap_or_default())}/></div>}
                            <div class="w-[58px] shrink-0 text-caption text-faint-ink" style={|s|s.font_family(theme.mono)}>{item.hash.unwrap_or_default()}</div>
                            if date {<div class="w-[95px] shrink-0 text-caption text-faint-ink">{item.date.unwrap_or_default()}</div>}
                        </div>
                    }
                })).into_any_element();

                if let Some(build)=&menus {
                    let mut context=crate::ContextMenu::new(build(&row_id),menu_focus.clone());

                    context.children.push(row);

                    context.into_any_element()
                }else{row}
            }).w_full().h_full().min_w(width).with_sizing_behavior(gpui::ListSizingBehavior::Auto).into_any_element()
        };

        let scrollbars = scrollbar::bars(&scroll_state, cx);
        let measure = scrollbar::measure(&scroll_state);

        let content = gpui::div()
            .id(self.id)
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_x_scroll()
            .overflow_y_hidden()
            .track_scroll(&horizontal)
            .role(accesskit::Role::ListBox)
            .aria_label("Commit graph")
            .a11y_synthetic_children(move |builder| {
                if multiselect {
                    builder.parent_node().set_multiselectable();
                }
            })
            .track_focus(&focus)
            .debug_selector(|| "graph-commits".into())
            .on_mouse_down(gpui::MouseButton::Left, move |_, window, cx| {
                window.focus(&pointer_focus, cx)
            })
            .on_key_down(move |event, window, cx| {
                let selected = keyboard.update(cx, |state, cx| state.key(event, window, cx));

                if let Some(id) = selected {
                    if let Some(handler) = &key_modified {
                        handler(
                            &crate::CommitSelectionEvent {
                                id,
                                modifiers: event.keystroke.modifiers,
                            },
                            window,
                            cx,
                        );
                    } else if key_selected.as_ref() != Some(&id)
                        && let Some(handler) = &key_handler
                    {
                        handler(&id, window, cx);
                    }
                }
            })
            .child(content);

        let content = gpui::div()
            .relative()
            .size_full()
            .min_w_0()
            .min_h_0()
            .child(content)
            .child(measure)
            .child(scrollbars)
            .into_any_element();

        if let Some(mut menu) = keyboard_menu {
            menu.id = format!("keyboard-{:?}", menu.id).into();
            let mut context = crate::ContextMenu::new(menu, focus);

            context.fill = true;
            context.children.push(content);

            context.into_any_element()
        } else {
            content
        }
    }
}
