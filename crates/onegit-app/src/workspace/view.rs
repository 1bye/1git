use super::{
    PreviewState, RepositoryState, RepositoryWorkspace,
    read::{self, Loaded, Preview},
    write,
};

use onegit_git::FileStatus;

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, DiffView, DiffViewer, Icon, IconName,
    IconSize, InputAvailability, ResizableSplit, Text, TextArea, TextInput, TextRole, TextTone,
    Theme, ToastHost,
};

use rake::gpui::{self, ColorExt, accesskit, prelude::*, px};
use std::{rc::Rc, sync::Arc};

fn notice(
    id: &'static str,
    title: impl Into<gpui::SharedString>,
    detail: impl Into<gpui::SharedString>,
) -> gpui::AnyElement {
    let title: gpui::SharedString = title.into();
    let detail: gpui::SharedString = detail.into();
    let announcement = format!("{title}. {detail}");

    rake::view! {
        <div id={id} role={accesskit::Role::Status} aria-label={announcement}
            class="size-full flex flex-col items-start gap-3 p-6 bg-surface-sunken overflow-y-scroll"
            style={|s| s.a11y_synthetic_children(|builder| {let node=builder.parent_node();node.set_live(accesskit::Live::Polite);node.set_live_atomic();})}>
            <Text role={TextRole::Title} {..Text::new("title",title)}/>
            <Text tone={TextTone::Muted} {..Text::new("detail",detail)}/>
        </div>
    }.into_any_element()
}

impl RepositoryWorkspace {
    fn files(
        &self,
        loaded: Arc<Loaded>,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let count = loaded.files.len();
        let staged = write::staged_count(&loaded);
        let writable = self.can_write();
        let allowed = write::available(&loaded);
        let selected = self.selected.clone();
        let focused = self.files_focus.is_focused(window);
        let focus = self.files_focus.clone().tab_stop(count > 0);

        let callback = Rc::new(cx.listener(|this, key: &read::ChangeKey, window, cx| {
            window.focus(&this.files_focus, cx);

            if this.selected.as_ref() != Some(key) {
                this.select(key.clone(), cx);
            }
        }));

        let list=gpui::uniform_list("files",count,move |range,_,_|range.map(|index| {
            let file=&loaded.files[index];
            let key=file.key.clone();
            let active=selected.as_ref()==Some(&key);
            let theme=Theme::current();
            let status=read::status_name(file.status);
            let ink=match file.status {FileStatus::Added|FileStatus::Untracked=>theme.success,FileStatus::Deleted|FileStatus::Unmerged=>theme.danger,FileStatus::Renamed|FileStatus::Copied=>theme.accent,_=>theme.muted_ink};
            let callback=callback.clone();

            rake::view! {
                <div id={index} role={accesskit::Role::ListBoxOption} aria-label={format!("{}, {}",file.label,file.description)}
                    class="w-full h-[52px] min-w-0 flex flex-row items-center gap-2 px-3 border-1 overflow-hidden"
                    style={|s|s.bg(if active {theme.selection} else {theme.surface}).border_color(if active && focused {theme.focus_ring} else {gpui::transparent_black()})
                        .aria_selected(active).when(active,|s|s.aria_active_descendant()).hover(|s|s.bg(if active {theme.selection.blend(&theme.hover.opacity(0.4))} else {theme.hover})).cursor(gpui::CursorStyle::PointingHand)
                        .debug_selector(||format!("workspace-file-{index}"))
                        .a11y_synthetic_children(move |builder|{builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(count);})}
                    on:click={move |_,window,cx| {cx.stop_propagation();callback(&key,window,cx);}}>
                    <Icon size={IconSize::Small} {..Icon::new("file",IconName::File)}/>
                    <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                        <Text max_lines={Some(1)} {..Text::new("path",file.label.clone())}/>
                        <Text max_lines={Some(1)} role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("status",file.description.clone())}/>
                    </div>
                    <div class="shrink-0 text-caption" style={|s|s.text_color(ink)}>{status}</div>
                </div>
            }.into_any_element()
        }).collect()).size_full().min_w_0().min_h_0().track_scroll(&self.files_scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        rake::view! {
            <div class="size-full flex flex-col bg-surface min-w-0 min-h-0">
                <div class="p-3 border-b-1 border-line shrink-0 flex flex-col gap-2">
                    <Text role={TextRole::Title} {..Text::new("title",format!("Changes · {count}"))}/>
                    <div class="flex flex-row items-center gap-1">
                        <Button size={ControlSize::Small} state={if writable && count > staged {ControlState::Enabled} else {ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.start_write(write::Operation::StageAll,window,cx))))} {..Button::new("stage-all","Stage all")}/>
                        <Button size={ControlSize::Small} state={if writable && staged > 0 {ControlState::Enabled} else {ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.start_write(write::Operation::UnstageAll,window,cx))))} {..Button::new("unstage-all","Unstage all")}/>
                    </div>
                </div>
                <div id="file-list" role={accesskit::Role::ListBox} aria-label="Changed files"
                    class="flex-1 min-h-0 min-w-0 overflow-hidden border-1 border-line"
                    style={|s|s.track_focus(&focus).focus_visible(|s|s.border_color(Theme::current().focus_ring)).debug_selector(||"workspace-files".into())
                        .on_key_down(cx.listener(|this,event,window,cx|this.navigate_files(event,window,cx)))}>
                    {list}
                </div>
                <div class="p-3 shrink-0 border-t-1 border-line flex flex-col gap-2">
                    <Text role={TextRole::Title} {..Text::new("commit-heading",format!("Commit · {staged} staged"))}/>
                    if !allowed {<Text role={TextRole::Caption} tone={TextTone::Danger} {..Text::new("operation-blocked","Finish the current Git operation and resolve conflicts in your editor first.")}/>}
                    <TextInput placeholder={"Summary of your changes".into()} availability={if writable {InputAvailability::Enabled} else {InputAvailability::Disabled}} {..TextInput::new("commit-summary",&self.summary,"Summary")}/>
                    <TextArea rows={2} placeholder={"Optional description".into()} availability={if writable {InputAvailability::Enabled} else {InputAvailability::Disabled}} {..TextArea::new("commit-description",&self.description,"Description")}/>
                    <Button variant={ButtonVariant::Primary} state={if self.write_job.is_some() {ControlState::Busy} else if self.can_commit(cx) {ControlState::Enabled} else {ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.commit(window,cx))))} {..Button::new("commit","Commit staged changes")}/>
                </div>
            </div>
        }.into_any_element()
    }

    fn preview_view(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let selected_file = match (&self.state, &self.selected) {
            (RepositoryState::Ready(loaded), Some(key)) => loaded.file(key).cloned(),
            _ => None,
        };

        let selected_file = selected_file.map(|file| {
            let label = if file.key.side == read::Side::Staged {
                "Unstage file"
            } else {
                "Stage file"
            };

            (file, label)
        });

        let writable = self.can_write();

        let content = match &self.preview {
            PreviewState::Empty => notice(
                "no-selection",
                "Select a changed file",
                "Its patch will appear here.",
            ),
            PreviewState::Loading => notice(
                "loading-patch",
                "Loading changes…",
                "Reading the selected file's patch.",
            ),
            PreviewState::Failed(error) => {
                notice("patch-error", "Could not load this patch", error.clone())
            }
            PreviewState::Ready(Preview::Notice { title, detail }) => {
                notice("patch-notice", *title, detail.clone())
            }
            PreviewState::Ready(Preview::Patch(document)) => {
                let title = self
                    .selected
                    .as_ref()
                    .map(|key| format!("{} · {}", read::path_label(&key.path), key.side.label()))
                    .unwrap_or_default();

                rake::view! {<DiffViewer view={self.view} {..DiffViewer::new("diff",title,document.clone())}/>}.into_any_element()
            }
        };

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col bg-surface-sunken">
                <div class="flex flex-row items-center gap-1 px-3 py-2 shrink-0 border-b-1 border-line bg-surface">
                    for (index,(view,label)) in [(DiffView::Unified,"Unified"),(DiffView::Split,"Split")].into_iter().enumerate() {
                        <Button id={("mode",index).into()} variant={if self.view==view {ButtonVariant::Secondary} else {ButtonVariant::Ghost}}
                            on_press={Some(Box::new(cx.listener(move |this,_,_,cx|{this.view=view;cx.notify();})))} {..Button::new("mode",label)}/>
                    }
                    <div class="flex-1"/>
                    if let Some((file,label))=selected_file {
                        <Button state={if writable {ControlState::Enabled} else {ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(move |this,_,window,cx|this.start_write(write::Operation::File(file.clone()),window,cx))))}
                            {..Button::new("stage-file",label)}/>
                    }
                    if matches!(self.preview,PreviewState::Failed(_)) {<Button variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(key)=this.selected.clone() {this.select(key,cx);}})))} {..Button::new("retry-patch","Retry")}/>}
                </div>
                <div class="flex-1 min-w-0 min-h-0">{content}</div>
            </div>
        }.into_any_element()
    }
}

impl Render for RepositoryWorkspace {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let (title, subtitle) = match &self.state {
            RepositoryState::Ready(loaded) => {
                let root = &loaded.snapshot.repository.root;
                let head = &loaded.snapshot.status.head;

                let branch = head.branch.clone().unwrap_or_else(|| {
                    if head.is_detached() {
                        format!(
                            "Detached HEAD · {}",
                            head.oid
                                .as_deref()
                                .unwrap_or("")
                                .chars()
                                .take(8)
                                .collect::<String>()
                        )
                    } else {
                        "No commits yet".into()
                    }
                });

                (
                    root.file_name()
                        .unwrap_or(root.as_os_str())
                        .to_string_lossy()
                        .into_owned(),
                    format!("{branch} · {}", root.display()),
                )
            }
            _ => ("1git".into(), "Your repositories, in focus.".into()),
        };

        let body = match &self.state {
            RepositoryState::Welcome => notice(
                "welcome",
                "Open a repository",
                "Choose a local working folder to browse its changed files and patches.",
            ),
            RepositoryState::Loading(path) => {
                notice("opening", "Opening repository…", path.display().to_string())
            }
            RepositoryState::Failed { error, .. } => notice(
                "repository-error",
                "Could not open this repository",
                error.clone(),
            ),
            RepositoryState::Ready(loaded) => {
                let files = self.files(loaded.clone(), window, cx);

                let preview = if loaded.files.is_empty() {
                    notice(
                        "clean",
                        "Working tree is clean",
                        "There are no staged or unstaged changes to display.",
                    )
                } else {
                    self.preview_view(cx)
                };

                rake::view! {<ResizableSplit min_first={px(220.)} min_second={px(240.)} first={files} second={preview} {..ResizableSplit::new("workspace-split",&self.split,"Changed files width")}/>}.into_any_element()
            }
        };

        rake::view! {
            <main class="size-full min-w-0 min-h-0 flex flex-col bg-background text-ink" focus={&self.focus} tab-navigation={true}>
                <header class="px-4 py-3 flex flex-row items-center gap-3 shrink-0 border-b-1 border-line">
                    <div class="flex-1 min-w-0 flex flex-col gap-1">
                        <Text max_lines={Some(1)} role={TextRole::Title} {..Text::new("repository",title)}/>
                        <Text max_lines={Some(1)} role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("branch",subtitle)}/>
                    </div>
                    <Button variant={ButtonVariant::Primary} icon={Some(IconName::Folder)} state={if self.write_job.is_some() {ControlState::Disabled} else if self.picker.is_some() {ControlState::Busy} else {ControlState::Enabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose_repository(cx))))} {..Button::new("open","Open repository…")}/>
                    <Button variant={ButtonVariant::Secondary} icon={Some(IconName::Refresh)} state={if self.write_job.is_some() || self.picker.is_some() {ControlState::Disabled} else {match self.state {RepositoryState::Loading(_)=>ControlState::Busy,RepositoryState::Ready(_)|RepositoryState::Failed {..}=>ControlState::Enabled,_=>ControlState::Disabled}}}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.refresh(cx))))} {..Button::new("refresh","Refresh")}/>
                </header>
                if let Some(error)=&self.picker_error {<div class="px-4 py-2"><Text tone={TextTone::Danger} {..Text::new("picker-error",error.clone())}/></div>}
                <div class="flex-1 min-h-0 min-w-0">{body}</div>
                <ToastHost {..ToastHost::new("notifications",&self.toasts,&self.focus)}/>
            </main>
        }
    }
}
