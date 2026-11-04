//! Cancellable history search with a retained normal list and immutable preview.
use super::{DetailState, HistoryWorkspace, files};
use crate::workspace::{PreviewState, replay};
use gpui_ce_motion::{Easing, Transition};
use onegit_git::{CommitInfo, GitPath};

use onegit_ui::{
    Button, ButtonVariant, CommitListData, ControlSize, DiffView, InputVariant, TextInput, TextRole,
};

use rake::gpui::{self, AppContext, Focusable, prelude::*, px};
use std::time::Duration;

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

pub(super) struct Normal {
    pub(super) data: CommitListData,
    pub(super) commits: HashMap<gpui::SharedString, Arc<CommitInfo>>,
    pub(super) list_state: gpui::Entity<onegit_ui::CommitListState>,
    pub(super) page_loaded: bool,
    pub(super) restore_rows: Option<usize>,
    pub(super) restoring_file: Option<GitPath>,
    pub(super) total: Option<u64>,
    pub(super) next_offset: Option<u64>,
    pub(super) page_error: Option<String>,
    pub(super) selected: Option<gpui::SharedString>,
    pub(super) selection: replay::Selection,
    pub(super) detail: DetailState,
    pub(super) file: Option<GitPath>,
    pub(super) preview: PreviewState,
    pub(super) diff_state: Option<gpui::Entity<onegit_ui::DiffViewerState>>,
    pub(super) view: DiffView,
    pub(super) tree_layout: bool,
    pub(super) collapsed: HashSet<Vec<u8>>,
    pub(super) file_rows: Arc<[files::Row]>,
    pub(super) file_cursor: Option<files::Entry>,
    pub(super) files_scroll: gpui::UniformListScrollHandle,
}

impl HistoryWorkspace {
    pub(super) fn searching(&self) -> bool {
        !self.search_query.trim().is_empty()
    }

    pub(super) fn set_query(&mut self, query: String, cx: &mut gpui::Context<Self>) {
        if query == self.search_query {
            return;
        }

        self.page_job = None;
        self.search_query = query;

        if !self.searching() {
            if let Some(normal) = self.normal.take() {
                self.detail_job = None;
                self.patch_job = None;
                self.data = normal.data;
                self.commits = normal.commits;
                self.list_state = normal.list_state;
                self.page_loaded = normal.page_loaded;
                self.restore_rows = normal.restore_rows;
                self.restoring_file = normal.restoring_file;
                self.total = normal.total;
                self.next_offset = normal.next_offset;
                self.page_error = normal.page_error;
                self.selected = normal.selected;
                self.selection = normal.selection;
                self.detail = normal.detail;
                self.file = normal.file;
                self.preview = normal.preview;
                self.diff_state = normal.diff_state;
                self.view = normal.view;
                self.tree_layout = normal.tree_layout;
                self.collapsed = normal.collapsed;
                self.file_rows = normal.file_rows;
                self.file_cursor = normal.file_cursor;
                self.files_scroll = normal.files_scroll;

                self.update_tag_labels();

                if !matches!(self.detail, DetailState::Ready(_))
                    && let Some(oid) = self.selected.clone()
                {
                    let file = self.file.clone().or(self.restoring_file.clone());

                    self.load_commit(oid, None, file, cx);
                }
            }

            if !self.page_loaded && self.page_job.is_none() {
                self.load_page(cx);
            }
        } else {
            if self.normal.is_none() {
                self.detail_job = None;
                self.patch_job = None;
                self.normal = Some(Normal {
                    data: std::mem::take(&mut self.data),
                    commits: std::mem::take(&mut self.commits),
                    list_state: std::mem::replace(
                        &mut self.list_state,
                        cx.new(onegit_ui::CommitListState::new),
                    ),
                    page_loaded: std::mem::take(&mut self.page_loaded),
                    restore_rows: self.restore_rows.take(),
                    restoring_file: self.restoring_file.take(),
                    total: self.total.take(),
                    next_offset: self.next_offset.take(),
                    page_error: self.page_error.take(),
                    selected: self.selected.take(),
                    selection: std::mem::take(&mut self.selection),
                    detail: std::mem::replace(&mut self.detail, DetailState::Empty),
                    file: self.file.take(),
                    preview: std::mem::replace(&mut self.preview, PreviewState::Empty),
                    diff_state: self.diff_state.take(),
                    view: self.view,
                    tree_layout: self.tree_layout,
                    collapsed: std::mem::take(&mut self.collapsed),
                    file_rows: std::mem::replace(&mut self.file_rows, Arc::from([])),
                    file_cursor: self.file_cursor.take(),
                    files_scroll: std::mem::replace(
                        &mut self.files_scroll,
                        gpui::UniformListScrollHandle::new(),
                    ),
                });
            }

            self.total = self
                .normal
                .as_ref()
                .and_then(|normal| normal.total)
                .or(self.total);
            self.page_loaded = false;
            self.restore_rows = None;
            self.next_offset = None;
            self.page_error = None;
            self.data = onegit_ui::CommitListData::default();
            self.list_state = cx.new(onegit_ui::CommitListState::new);
            self.load_page(cx);
        }

        cx.notify();
    }

    pub(in crate::workspace) fn search_shortcut(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let mods = event.keystroke.modifiers;

        let find = event.keystroke.key == "f"
            && (mods.control || (cfg!(target_os = "macos") && mods.platform));

        let close = event.keystroke.key == "escape"
            && !mods.modified()
            && (self.search_open || self.searching());

        if find && !mods.alt && !mods.shift {
            self.open_search(window, cx);
        } else if close {
            self.close_search(window, cx);
        } else {
            return;
        }

        window.prevent_default();
        cx.stop_propagation();
    }

    pub(super) fn open_search(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.search_open = true;
        window.focus(&self.search_input.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    fn close_search(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.set_query(String::new(), cx);
        self.search_input
            .update(cx, |input, cx| input.set_text("", cx));
        self.search_open = false;
        window.focus(&self.search_button, cx);
        cx.notify();
    }

    pub(super) fn search_bar(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let open = self.search_open || self.searching();

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.search_epoch);

        self.search_height.animate(
            if open { 30. } else { 0. },
            Transition::Tween(Duration::from_millis(120), Easing::EaseOut),
            time,
        );
        let height = self.search_height.sample(time, cx.reduce_motion());

        if height.is_animating() {
            window.request_animation_frame();
        }

        if !open && !height.is_animating() {
            return gpui::Empty.into_any_element();
        }

        rake::view! {
            <div class="shrink-0 overflow-hidden" style={|s|s.h(px(height.value() as f32)).debug_selector(||"history-search-bar".into())}>
                <div class="h-[30px] px-2 pb-1 flex flex-row items-center gap-1">
                    <div class="flex-1 min-w-0">
                        <TextInput height={Some(px(26.))} show_label={false} variant={InputVariant::Surface} text_role={Some(TextRole::Small)} size={ControlSize::Medium} placeholder={"Message, author or hash…".into()}
                            {..TextInput::new("history-search-input",&self.search_input,"Search commit messages, authors or hashes")}/>
                    </div>
                    <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} width={Some(px(32.))} padding={Some(px(0.))} accessibility_label={Some("Close history search".into())}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close_search(window,cx))))} {..Button::new("close-history-search","×")}/>
                </div>
            </div>
        }.into_any_element()
    }
}

pub(super) enum Empty {
    Results,
    Files,
    Details,
}

pub(super) fn empty(title: &'static str, detail: &'static str, kind: Empty) -> gpui::AnyElement {
    let compact = !matches!(kind, Empty::Details);

    let (key, data): (&'static str, &'static [u8]) = if matches!(kind, Empty::Files) {
        (
            "onegit-app/state-history",
            include_bytes!("../assets/state-history.svg"),
        )
    } else {
        (
            "onegit-app/state-search",
            include_bytes!("../assets/state-search.svg"),
        )
    };

    let drawing = gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            window
                .paint_svg(
                    bounds,
                    key.into(),
                    Some(data),
                    Default::default(),
                    onegit_ui::Theme::current().muted_ink,
                    cx,
                )
                .expect("original history state artwork is valid");
        },
    )
    .w(px(if compact { 80. } else { 160. }))
    .h(px(if compact { 56. } else { 112. }))
    .flex_shrink_0();

    rake::view! {
        <div role={gpui::accesskit::Role::Status} aria-label={title} class={if compact {"w-full min-w-0 flex flex-col items-center gap-2 p-3"}else{"size-full min-w-0 min-h-0 flex flex-col items-center justify-center gap-2 p-6"}}>
            {drawing}
            <p role={gpui::accesskit::Role::Heading} class={if compact {"text-small font-medium text-center max-w-[420px]"}else{"text-title font-medium text-center max-w-[420px]"}} style={|s|s.aria_level(2)}>{title}</p>
            if !detail.is_empty() {<p class="text-small text-faint-ink text-center max-w-[420px]">{detail}</p>}
        </div>
    }.into_any_element()
}

impl HistoryWorkspace {
    pub(super) fn empty_files(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="h-[28px] pl-3.5 pr-5 flex flex-row items-center justify-between shrink-0">
                    <p class="text-caption text-muted-ink">{"Changed files"}</p>
                    <Button size={ControlSize::Small} variant={if self.tree_layout{ButtonVariant::Secondary}else{ButtonVariant::Ghost}} tone={if self.tree_layout{onegit_ui::ButtonTone::Accent}else{onegit_ui::ButtonTone::Normal}} icon_size={Some(onegit_ui::IconSize::Supporting)} icon={Some(if self.tree_layout{onegit_ui::IconName::Tree}else{onegit_ui::IconName::List})} width={Some(px(26.))} height={Some(px(26.))} padding={Some(px(0.))} accessibility_label={Some(if self.tree_layout{"Switch to list view"}else{"Switch to tree view"}.into())}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.toggle_layout(cx))))} {..Button::new("empty-history-files-layout","")}/>
                </div>
                {empty("Select a commit to see its files.","",Empty::Files)}
            </div>
        }.into_any_element()
    }
}
