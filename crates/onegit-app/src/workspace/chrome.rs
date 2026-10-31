//! Original 1git shell geometry and shared file identity/patch toolbar composition.
use super::{
    PreviewState, RepositoryState, RepositoryWorkspace, Section,
    read::{self, Preview},
};

use onegit_git::{FileStatus, GitPath};

use onegit_ui::{
    Appearance, ButtonVariant, ControlSize, ControlState, DropdownMenu, Icon, IconButton, IconName,
    IconSize, MenuItem, Text, TextRole, TextTone, Theme, Tooltip,
};

use rake::gpui::{self, accesskit, prelude::*, px};
use std::sync::{Arc, OnceLock};

/// Reuse the original deterministic SVG as a cached image; no per-frame noise generation.
pub(super) fn grain() -> gpui::AnyElement {
    static IMAGES: OnceLock<[Arc<gpui::Image>; 2]> = OnceLock::new();
    let images = IMAGES.get_or_init(|| {
        let source = include_str!("assets/chrome-grain.svg");

        ["#000000", "#ffffff"].map(|color| {
            Arc::new(gpui::Image::from_bytes(
                gpui::ImageFormat::Svg,
                source.replace("currentColor", color).into_bytes(),
            ))
        })
    });

    let dark = Theme::current().appearance == Appearance::Dark;

    gpui::div()
        .absolute()
        .inset_0()
        .overflow_hidden()
        .child(
            gpui::img(images[usize::from(dark)].clone())
                .size_full()
                .object_fit(gpui::ObjectFit::Cover)
                .opacity(if dark { 0.12 } else { 0.09 }),
        )
        .into_any_element()
}

pub(super) fn age(timestamp: &str) -> String {
    let Ok(date) = chrono::DateTime::parse_from_rfc3339(timestamp) else {
        return timestamp.to_owned();
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let seconds = now.saturating_sub(date.timestamp()).max(0);

    let (count, unit) = if seconds < 60 {
        return "just now".into();
    } else if seconds < 3600 {
        (seconds / 60, "minute")
    } else if seconds < 86400 {
        (seconds / 3600, "hour")
    } else {
        (seconds / 86400, "day")
    };

    format!("{count} {unit}{} ago", if count == 1 { "" } else { "s" })
}

fn tab_surface() -> gpui::AnyElement {
    let color = Theme::current().surface;

    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let point = |x, y| bounds.origin + gpui::point(px(x), px(y));
            let mut path = gpui::PathBuilder::fill();

            path.move_to(point(0., 36.));
            path.curve_to(point(12., 24.), point(12., 36.));
            path.line_to(point(12., 10.));
            path.curve_to(point(22., 0.), point(12., 0.));
            path.line_to(point(208., 0.));
            path.curve_to(point(218., 10.), point(218., 0.));
            path.line_to(point(218., 24.));
            path.curve_to(point(230., 36.), point(218., 36.));
            path.close();

            if let Ok(path) = path.build() {
                window.paint_path(path, color);
            }
        },
    )
    .absolute()
    .left(px(-10.))
    .top_0()
    .w(px(230.))
    .h(px(36.))
    .into_any_element()
}

pub(super) fn file_identity(path: &GitPath) -> gpui::AnyElement {
    let label = read::path_label(path);
    let (directory, filename) = label.rsplit_once('/').unwrap_or(("", &label));

    rake::view! {
        <div class="flex flex-row items-center gap-1.5 min-w-0 overflow-hidden">
            <div class="shrink-0 min-w-0"><Text role={TextRole::Small} max_lines={Some(1)} {..Text::new("filename",filename.to_owned())}/></div>
            if !directory.is_empty() {<div class="min-w-0"><p class="text-caption text-faint-ink whitespace-nowrap">{directory}</p></div>}
        </div>
    }.into_any_element()
}

pub(super) fn status_icon(status: FileStatus) -> gpui::AnyElement {
    let theme = Theme::current();

    let (icon, ink) = match status {
        FileStatus::Added | FileStatus::Untracked => (IconName::FileAdded, theme.success),
        FileStatus::Deleted => (IconName::FileDeleted, theme.faint_ink),
        FileStatus::Renamed | FileStatus::Copied => (IconName::FileRenamed, theme.accent),
        FileStatus::Unmerged => (IconName::Alert, theme.warning),
        _ => (IconName::FileModified, theme.accent),
    };

    rake::view! {<div class="shrink-0" style={|s|s.text_color(ink)}><Icon size={IconSize::Small} {..Icon::new("status-icon",icon)}/></div>}.into_any_element()
}

pub(super) fn patch_toolbar(
    path: Option<&GitPath>,
    preview: &PreviewState,
    context: &str,
    controls: gpui::AnyElement,
) -> gpui::AnyElement {
    let identity = path
        .map(file_identity)
        .unwrap_or_else(|| gpui::Empty.into_any_element());

    let counts = match preview {
        PreviewState::Ready(Preview::Patch(doc)) => {
            Some((doc.added_lines(), doc.deleted_lines(), doc.is_binary()))
        }
        _ => None,
    };

    rake::view! {
        <div class="h-[36px] flex flex-row items-center gap-1.5 pl-3.5 pr-3 shrink-0 border-b-1 border-hairline"
            style={|s|s.debug_selector(||"workspace-patch-toolbar".into())}>
            <div class="flex-1 min-w-0">{identity}</div>
            if !context.is_empty() {<Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("context",context.to_owned())}/>}
            if let Some((added,deleted,binary))=counts {
                if binary {<Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("binary","Binary change")}/>}
                else {
                    <Text role={TextRole::Caption} tone={TextTone::Success} {..Text::new("added",format!("+{added}"))}/>
                    <Text role={TextRole::Caption} tone={TextTone::Danger} {..Text::new("deleted",format!("−{deleted}"))}/>
                }
            }
            {controls}
        </div>
    }.into_any_element()
}

impl RepositoryWorkspace {
    pub(super) fn titlebar(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let (name, branch, count) = match &self.state {
            RepositoryState::Ready(loaded) => {
                let root = &loaded.snapshot.repository.root;

                (
                    root.file_name()
                        .unwrap_or(root.as_os_str())
                        .to_string_lossy()
                        .into_owned(),
                    loaded
                        .snapshot
                        .status
                        .head
                        .branch
                        .clone()
                        .unwrap_or_else(|| {
                            if loaded.snapshot.status.head.is_detached() {
                                "Detached HEAD".into()
                            } else {
                                "No commits yet".into()
                            }
                        }),
                    loaded.snapshot.status.files.len(),
                )
            }
            _ => ("1git".into(), String::new(), 0),
        };

        let open_state = if self.write_job.is_some() {
            ControlState::Disabled
        } else if self.picker.is_some() {
            ControlState::Busy
        } else {
            ControlState::Enabled
        };

        let ready = matches!(self.state, RepositoryState::Ready(_));
        let theme = Theme::current();
        let tab_surface = tab_surface();

        rake::view! {
            <div class="h-[42px] shrink-0 flex flex-row items-end pr-1.5" style={|s|s.pl(px(if cfg!(target_os="macos"){86.}else{12.})).debug_selector(||"workspace-titlebar".into())}>
                <div class="relative w-[24px] h-[32px] mb-1 mr-2.5" style={|s|s.debug_selector(||"workspace-home".into())}><div class="absolute top-0 left-0 size-[32px] rounded-[6px]" style={|s|s.when(self.home_visible,|s|s.bg(theme.hairline))}>
                    <Tooltip {..Tooltip::new("open-tip","Home")}>
                        <IconButton size={ControlSize::Rail} state={open_state} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.home_visible=true;cx.notify();})))} {..IconButton::new("open",IconName::Home,"Home")}/>
                    </Tooltip>
                </div></div>
                if !matches!(self.state,RepositoryState::Welcome) {<div role={accesskit::Role::Tab} aria-label={format!("{name} / {branch}")} class="relative w-[210px] h-[36px] flex flex-row items-center gap-2 px-3 pb-2 min-w-0"
                    style={|s|s.aria_selected(!self.home_visible).debug_selector(||"workspace-repository-tab".into()).on_mouse_down(gpui::MouseButton::Left,cx.listener(|this,_,_,cx|{this.home_visible=false;cx.notify();}))}>
                    if !self.home_visible {{tab_surface}}
                    {self.home.read(cx).repository_avatar(match &self.state {RepositoryState::Ready(loaded)=>Some(loaded.snapshot.repository.root.as_path()),_=>None},&name,14.)}
                    <div class="flex-1 min-w-0 overflow-hidden whitespace-nowrap text-small">{gpui::StyledText::new(gpui::SharedString::from(format!("{name} / {branch}"))).with_highlights([(name.len()..name.len()+3+branch.len(),gpui::HighlightStyle {color:Some(theme.muted_ink),..Default::default()})])}</div>
                    if ready && count>0 {<div class="rounded-[3px] px-1 text-caption shrink-0" style={|s|s.bg(if theme.appearance==Appearance::Dark {gpui::rgb(0x3e372c)}else{gpui::rgb(0xf6f1e8)}).text_color(if theme.appearance==Appearance::Dark {gpui::rgb(0xd2ba95)}else{gpui::rgb(0x80633d)})}>{if count>99 {"99+".into()}else{count.to_string()}}</div>}
                </div>}
                <div class="flex-1 h-full" style={|s|s.debug_selector(||"workspace-window-drag".into()).on_mouse_down(gpui::MouseButton::Left,|event,window,_|{if event.click_count==2 {window.titlebar_double_click();}else{window.start_window_move();}})}/>
                if !self.home_visible {<div class="mb-2"><IconButton size={ControlSize::Small} state={open_state} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose_repository(cx))))} {..IconButton::new("open-another",IconName::Plus,"Open another repository…")}/></div>}
            </div>
        }.into_any_element()
    }

    pub(super) fn rail(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let ready = matches!(self.state, RepositoryState::Ready(_));
        let theme = Theme::current();

        let tracking = match &self.state {
            RepositoryState::Ready(loaded) => {
                let head = &loaded.snapshot.status.head;

                if head.ahead > 0 {
                    format!("↑ {}", head.ahead)
                } else if head.behind > 0 {
                    format!("↓ {}", head.behind)
                } else {
                    String::new()
                }
            }
            _ => String::new(),
        };

        let entries = [
            MenuItem {
                selected: Some(theme.appearance == Appearance::Light),
                ..MenuItem::new("light", "Light appearance")
            }
            .into(),
            MenuItem {
                selected: Some(theme.appearance == Appearance::Dark),
                ..MenuItem::new("dark", "Dark appearance")
            }
            .into(),
        ]
        .to_vec();

        rake::view! {
            <nav aria-label="Workspace tools" class="w-[48px] shrink-0 flex flex-col items-center gap-1 pt-1.5 pb-3" style={|s|s.debug_selector(||"workspace-rail".into())}>
                if !self.home_visible {
                <Tooltip {..Tooltip::new("sync-unavailable",if tracking.is_empty(){"Synchronization is not ported to Rust yet".to_owned()}else{format!("{tracking} commits since the last fetch. Synchronization is not ported to Rust yet")})}>
                    <div class="size-[32px] relative flex items-center justify-center text-muted-ink"><Icon size={IconSize::Navigation} label={Some("Synchronization unavailable".into())} {..Icon::new("sync-status",if tracking.is_empty(){IconName::Refresh}else{IconName::ArrowUp})}/>
                        if !tracking.is_empty(){<div class="absolute top-[24px] rounded-[2px] px-0.5 text-caption bg-surface">{tracking.clone()}</div>}
                    </div>
                </Tooltip>
                <Tooltip {..Tooltip::new("branches-unavailable","Branch switching is not ported to Rust yet")}><div class="size-[32px] flex items-center justify-center text-muted-ink"><Icon size={IconSize::Navigation} label={Some("Branch switching unavailable".into())} {..Icon::new("branches",IconName::Branches)}/></div></Tooltip>
                <div class="w-5 h-[1px] bg-line"/>
                <div role={accesskit::Role::TabList} aria-label="Repository views" class="flex flex-col gap-1">
                    for (index,(section,id,label,icon)) in [(Section::Changes,"changes","Changes",IconName::Changes),(Section::History,"history","History",IconName::History)].into_iter().enumerate() {
                        <Tooltip id={format!("rail-tip-{id}").into()} {..Tooltip::new("section-tip",label)}>
                            <button id={id} focus={&self.section_focus[index]} tabindex={if self.section==section {0}else{-1}} disabled={!ready} aria-label={label} class="size-[32px] flex items-center justify-center rounded-[6px] border-1 focus-visible:border-focus-ring"
                                style={|s|s.border_color(gpui::transparent_black()).role(accesskit::Role::Tab).aria_selected(self.section==section).bg(if self.section==section && ready {theme.hairline}else{gpui::transparent_black()}).text_color(if self.section==section {theme.ink}else{theme.muted_ink}).hover(|s|s.bg(theme.hairline)).debug_selector(move ||format!("tab-{id}"))
                                    .on_key_down(cx.listener(|this,event,window,cx|this.navigate_sections(event,window,cx)))}
                                on:click={cx.listener(move |this,_,window,cx|{this.change_section(&gpui::ElementId::from(id),cx);window.focus(&this.section_focus[index],cx);})}>
                                <Icon size={IconSize::Navigation} {..Icon::new("glyph",icon)}/>
                            </button>
                        </Tooltip>
                    }
                </div>
                <Tooltip {..Tooltip::new("stashes-unavailable","Stashes are not ported to Rust yet")}><div class="size-[32px] flex items-center justify-center text-muted-ink"><Icon size={IconSize::Navigation} label={Some("Stashes unavailable".into())} {..Icon::new("stashes",IconName::Stashes)}/></div></Tooltip>
                <Tooltip {..Tooltip::new("graph-unavailable","Graph is not ported to Rust yet")}><div class="size-[32px] flex items-center justify-center text-muted-ink"><Icon size={IconSize::Navigation} label={Some("Graph unavailable".into())} {..Icon::new("graph",IconName::Graph)}/></div></Tooltip>
                }
                <div class="flex-1 w-full" style={|s|s.on_mouse_down(gpui::MouseButton::Left,|_,window,_|window.start_window_move())}/>
                <Tooltip {..Tooltip::new("appearance-tip","Workspace appearance")}>
                    <DropdownMenu icon_only={true} icon={Some(IconName::Settings)} size={ControlSize::Rail} variant={ButtonVariant::Ghost} entries={entries}
                        on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,window,cx| {let theme=if *id==gpui::ElementId::from("light"){Theme::light()}else{Theme::dark()};let appearance=theme.appearance;theme.install(cx);this.picker_error=super::native::appearance(window,appearance).err();cx.notify();})))}
                        {..DropdownMenu::new("workspace-appearance","Workspace appearance")}/>
                </Tooltip>
                <Tooltip {..Tooltip::new("account-tip","Accounts")}><IconButton size={ControlSize::Rail} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.home_visible=true;this.home.update(cx,|home,cx|home.accounts(window,cx));cx.notify();})))} {..IconButton::new("rail-account",IconName::Account,"Accounts")}/></Tooltip>
            </nav>
        }.into_any_element()
    }
}
