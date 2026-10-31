use super::{
    Form, Home, HomeEvent,
    library::{Folder, Layout, Overview},
};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability, DialogHost,
    DropdownMenu, Icon, IconName, IconSize, InputAvailability, MenuItem, SearchField, Text,
    TextInput, TextRole, TextTone, Theme,
};

use rake::gpui::Focusable;
use rake::gpui::{self, accesskit, prelude::*, px};

fn action(
    id: impl Into<gpui::ElementId>,
    label: &str,
    icon: IconName,
    selected: bool,
    height: f32,
    on_press: onegit_ui::PressHandler,
) -> gpui::AnyElement {
    let theme = Theme::current();

    rake::view! {
        <button id={id.into()} aria-label={label.to_owned()} class="w-full shrink-0 flex flex-row items-center justify-start gap-2.5 px-2 rounded-[4px] text-small border-1 focus-visible:border-focus-ring"
            style={|s|s.h(px(height)).border_color(gpui::transparent_black()).bg(if selected{theme.hairline}else{gpui::transparent_black()}).text_color(theme.ink).hover(|s|s.bg(theme.hairline))}
            on:click={on_press}>
            <div style={|s|s.text_color(theme.muted_ink)}><Icon size={IconSize::Navigation} {..Icon::new("icon",icon)}/></div>
            {label.to_owned()}
        </button>
    }.into_any_element()
}

pub(super) fn avatar(
    label: &str,
    image: Option<std::sync::Arc<gpui::Image>>,
    size: f32,
) -> gpui::AnyElement {
    let theme = Theme::current();

    gpui::div()
        .w(px(size))
        .h(px(size))
        .flex_shrink_0()
        .rounded(px(4.).min(px(size / 4.)))
        .overflow_hidden()
        .bg(theme.selection)
        .flex()
        .items_center()
        .justify_center()
        .text_size(px((size * 0.4).max(9.)))
        .text_color(theme.muted_ink)
        .child(match image {
            Some(image) => gpui::img(image)
                .size_full()
                .object_fit(gpui::ObjectFit::Cover)
                .rounded(px(4.).min(px(size / 4.)))
                .into_any_element(),
            None => gpui::div()
                .child(
                    label
                        .trim()
                        .chars()
                        .next()
                        .unwrap_or('?')
                        .to_uppercase()
                        .to_string(),
                )
                .into_any_element(),
        })
        .into_any_element()
}

fn repository_count(count: usize) -> String {
    format!(
        "{count} {}",
        if count == 1 {
            "repository"
        } else {
            "repositories"
        }
    )
}

fn overview(overview: Option<&Result<Overview, String>>) -> gpui::AnyElement {
    let theme = Theme::current();

    match overview {
        Some(Ok(value))=>rake::view! {
            <div class="w-full min-w-0 flex flex-col gap-1 text-caption text-muted-ink">
                <div class="flex flex-row items-center gap-1 min-w-0"><Icon size={IconSize::Small} {..Icon::new("branch-icon",IconName::Graph)}/><div class="flex-1 min-w-0 overflow-hidden whitespace-nowrap">{value.branch.clone()}</div></div>
                <div class="flex flex-row items-center gap-2"><div style={|s|s.text_color(if value.changes>0{theme.ink}else{theme.success})}>{if value.changes>0 {format!("{} changed",value.changes)}else{"Clean".into()}}</div><div>{value.tracking.clone()}</div></div>
            </div>
        }.into_any_element(),
        Some(Err(_))=>rake::view!{<p class="text-caption text-muted-ink">{"Status unavailable"}</p>}.into_any_element(),
        None=>rake::view!{<p class="text-caption text-muted-ink">{"Checking status…"}</p>}.into_any_element(),
    }
}

impl Home {
    fn sidebar(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let local = action(
            "home-local",
            "This Mac",
            IconName::Computer,
            true,
            38.,
            Box::new(cx.listener(|this, _, _, cx| {
                this.filter(cx);
            })),
        );

        let add = action(
            "home-add-machine",
            "Add machine…",
            IconName::Plus,
            false,
            24.,
            Box::new(cx.listener(|this, _, window, cx| this.show(Form::Machines, window, cx))),
        );

        let create = action(
            "home-create",
            "Create repository",
            IconName::Plus,
            false,
            24.,
            Box::new(cx.listener(|this, _, window, cx| this.show(Form::Create, window, cx))),
        );

        let clone = action(
            "home-clone",
            "Clone repository",
            IconName::Branch,
            false,
            24.,
            Box::new(cx.listener(|this, _, window, cx| this.show(Form::Clone, window, cx))),
        );

        let open = action(
            "home-open",
            "Open from disk",
            IconName::Folder,
            false,
            24.,
            Box::new(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::Pick))),
        );

        let scan = action(
            "home-scan",
            if self.scan_job.is_some() {
                "Scanning…"
            } else {
                "Scan repositories"
            },
            IconName::Refresh,
            false,
            24.,
            Box::new(cx.listener(|this, _, _, cx| this.scan(cx))),
        );

        let theme = Theme::current();

        rake::view! {
            <div id="home-sidebar" class="w-[220px] shrink-0 min-h-0 overflow-y-scroll flex flex-col" style={|s|s.debug_selector(||"home-sidebar".into())}>
                <div class="flex flex-col gap-1 mb-6">
                    <p class="text-caption text-muted-ink ml-2.5 mb-2">{"MACHINES"}</p>
                    {local}
                    for (index,name) in self.library.machines.iter().enumerate() {
                        <button id={index} aria-label={format!("{name}, Disconnected")} class="w-full h-[48px] shrink-0 flex flex-row items-center gap-2.5 px-2 rounded-[4px] border-1 focus-visible:border-focus-ring"
                            style={|s|s.border_color(gpui::transparent_black()).hover(|s|s.bg(theme.hairline))}
                            on:click={cx.listener(|this,_,window,cx|this.show(Form::Machines,window,cx))}>
                            <div class="text-muted-ink"><Icon size={IconSize::Navigation} {..Icon::new("machine-icon",IconName::Server)}/></div>
                            <div class="flex-1 min-w-0 flex flex-col gap-0.5"><p class="text-small">{name.clone()}</p><p class="text-caption text-muted-ink">{"Disconnected"}</p></div>
                            <div class="text-muted-ink"><Icon size={IconSize::Navigation} {..Icon::new("machine-more",IconName::More)}/></div>
                        </button>
                    }
                    <div class="mt-1">{add}</div>
                </div>
                <p class="text-caption text-muted-ink ml-2.5 mb-3">{"QUICK ACTIONS"}</p>
                {create}<div class="mt-1">{clone}</div><div class="mt-1">{open}</div><div class="mt-1">{scan}</div>
                if let Some(error)=&self.error {<div class="mt-3 px-2.5"><Text role={TextRole::Small} tone={TextTone::Danger} {..Text::new("home-error",error.clone())}/></div>}
            </div>
        }.into_any_element()
    }

    fn search(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let theme = Theme::current();
        let count = self.library.scope().len();

        rake::view! {
            <div class="h-[40px] shrink-0 flex flex-row items-center gap-3 mb-3 min-w-0" style={|s|s.debug_selector(||"home-search-toolbar".into())}>
                if self.library.folder.is_some() {
                    <button id="home-back" aria-label="Back to folders" class="size-[40px] shrink-0 rounded-[4px] flex items-center justify-center text-muted-ink" style={|s|s.hover(|s|s.bg(theme.hairline))} on:click={cx.listener(|this,_,_,cx|this.back(cx))}><Icon size={IconSize::Navigation} {..Icon::new("back-icon",IconName::Back)}/></button>
                }
                <div class="flex-1 min-w-0"><SearchField show_label={false} size={ControlSize::Library} placeholder={format!("Search {count} {}",if count==1{"repository"}else{"repositories"}).into()} {..SearchField::new("home-search",&self.query,"Search repositories")}/></div>
                <div role={accesskit::Role::TabList} aria-label="Repository view" class="shrink-0 flex flex-row gap-1">
                    for (index,(layout,label,icon)) in [(Layout::Tiles,"Tile view",IconName::Grid),(Layout::List,"List view",IconName::List)].into_iter().enumerate() {
                        <button id={index} focus={&self.view_focus[index]} tabindex={if self.library.layout==layout{0}else{-1}} aria-label={label} class="size-[40px] rounded-[4px] flex items-center justify-center border-1 focus-visible:border-focus-ring"
                            style={|s|s.role(accesskit::Role::Tab).aria_selected(self.library.layout==layout).border_color(gpui::transparent_black()).bg(if self.library.layout==layout{theme.hairline}else{gpui::transparent_black()}).text_color(if self.library.layout==layout{theme.accent}else{theme.muted_ink}).hover(|s|s.bg(theme.hairline)).on_key_down(cx.listener(move |this,event: &gpui::KeyDownEvent,window,cx|{
                                if !event.keystroke.modifiers.modified() {match event.keystroke.key.as_str(){"left"|"right"=>this.layout(if layout==Layout::Tiles{Layout::List}else{Layout::Tiles},window,cx),"home"=>this.layout(Layout::Tiles,window,cx),"end"=>this.layout(Layout::List,window,cx),_=>{}}}
                            }))}
                            on:click={cx.listener(move |this,_,window,cx|this.layout(layout,window,cx))}><Icon size={IconSize::Navigation} {..Icon::new("view-icon",icon)}/></button>
                    }
                </div>
                if matches!(self.library.folder,Some(Folder::Path(_))) {<DropdownMenu size={ControlSize::Library} icon_only={true} icon={Some(IconName::More)} variant={ButtonVariant::Ghost}
                    entries={vec![MenuItem::new("scan","Scan again").into(),MenuItem::new("reveal","Reveal in Finder").into(),MenuItem::new("remove","Remove folder").into()]}
                    on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{
                        if *id==gpui::ElementId::from("scan"){this.scan(cx);}
                        else if *id==gpui::ElementId::from("reveal"){if let Some(Folder::Path(path))=&this.library.folder{cx.reveal_path(path);}}
                        else if let Some(Folder::Path(folder))=this.library.folder.take(){this.library.folders.retain(|path|path!=&folder);this.back(cx);}
                    })))} {..DropdownMenu::new("home-folder-more","Folder actions")}/>}
            </div>
        }.into_any_element()
    }

    fn repositories(&mut self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let paths = self.matches.clone();
        let entity = cx.entity().downgrade();
        let layout = self.library.layout;

        let columns = if layout == Layout::Tiles {
            ((f32::from(self.library_width) + 12.) / 152.)
                .floor()
                .max(1.) as usize
        } else {
            1
        };

        let card_width = ((f32::from(self.library_width) - 12. * columns.saturating_sub(1) as f32)
            / columns as f32)
            .clamp(140., 160.);

        for path in &paths {
            self.item_focus
                .entry(path.clone())
                .or_insert_with(|| cx.focus_handle());
        }

        let list=gpui::uniform_list("home-repositories",paths.len().div_ceil(columns),move |range,_,cx|{
            entity.update(cx,|this,cx|{
                this.schedule(&paths[range.start*columns..(range.end*columns).min(paths.len())],cx);

                range.map(|row|{
                    let cards=(row*columns..((row+1)*columns).min(paths.len())).map(|index|{
                    let path=paths[index].clone();let name=path.file_name().unwrap_or(path.as_os_str()).to_string_lossy().into_owned();
                    let data=this.overview.get(&path);let image=data.and_then(|data|data.as_ref().ok()).and_then(|value|value.avatar.clone());
                    let image=avatar(&name,image,if layout==Layout::Tiles{20.}else{28.});let details=overview(data);
                    let theme=Theme::current();let star_path=path.clone();let forget_path=path.clone();let starred=this.library.starred.contains(&path);let focus=this.item_focus[&path].clone();let key_path=path.clone();

                    rake::view!{
                        <div id={gpui::ElementId::from(gpui::SharedString::from(path.to_string_lossy().to_string()))} class="relative w-full shrink-0" style={|s|s.group("repository-card").when(layout==Layout::Tiles,|s|s.w(px(card_width))).pb(px(if layout==Layout::Tiles{12.}else{4.})).h(px(if layout==Layout::Tiles{124.}else{58.})).debug_selector(move ||format!("home-repository-row-{index}"))}>
                            <button id="open" focus={&focus} aria-label={format!("Open {}",path.display())}
                                class="flex min-w-0 rounded-[4px] border-1 focus-visible:border-focus-ring"
                                style={|s|s.h(px(if layout==Layout::Tiles{112.}else{54.})).when(layout==Layout::Tiles,|s|s.w(px(card_width)).flex_col().items_start().justify_start().p(px(12.)).gap(px(8.)))
                                    .when(layout==Layout::List,|s|s.w_full().flex_row().items_center().px(px(12.)).gap(px(10.)))
                                    .border_color(if layout==Layout::Tiles{theme.line}else{gpui::transparent_black()}).hover(|s|s.bg(theme.hairline)).debug_selector(move ||format!("home-repository-{index}"))
                                    .on_key_down(cx.listener(move |this,event: &gpui::KeyDownEvent,window,cx| {
                                        if event.keystroke.modifiers.modified(){return;}
                                        let Some(current)=this.matches.iter().position(|path|path==&key_path) else {return;};
                                        let next=match event.keystroke.key.as_str(){"up"=>current.saturating_sub(columns),"down"=>(current+columns).min(this.matches.len().saturating_sub(1)),"left"=>current.saturating_sub(1),"right"=>(current+1).min(this.matches.len().saturating_sub(1)),"home"=>0,"end"=>this.matches.len().saturating_sub(1),_=>return};
                                        this.scroll.scroll_to_item(next/columns,gpui::ScrollStrategy::Top);
                                        if let Some(focus)=this.matches.get(next).and_then(|path|this.item_focus.get(path)){window.focus(focus,cx);}
                                        cx.stop_propagation();cx.notify();
                                    }))}
                                on:click={cx.listener(move |_,_,_,cx|cx.emit(HomeEvent::Open(path.clone())))}>
                                {image}
                                <div class="min-w-0 flex flex-col gap-1" style={|s|s.when(layout==Layout::Tiles,|s|s.w_full()).when(layout==Layout::List,|s|s.flex_1())}>
                                    <p class="text-body overflow-hidden whitespace-nowrap">{name}</p>
                                    if layout==Layout::Tiles {{details}} else {<p class="text-small text-muted-ink overflow-hidden whitespace-nowrap">{&paths[index].to_string_lossy()}</p>}
                                </div>
                                if layout==Layout::List {<div class="w-[145px] shrink-0 min-w-0">{overview(data)}</div>}
                            </button>
                            <button id="star" aria-label={format!("{} {}",if starred{"Unstar"}else{"Star"},star_path.display())} class="absolute size-[26px] rounded-[4px] flex items-center justify-center border-1 focus-visible:border-focus-ring"
                                style={|s|s.top(px(10.)).right(px(if layout==Layout::Tiles{8.}else{36.})).when(layout==Layout::Tiles,|s|s.left(px(card_width-34.))).border_color(gpui::transparent_black()).text_color(if starred{theme.accent}else{theme.muted_ink}).opacity(if starred{1.}else{0.}).group_hover("repository-card",|s|s.opacity(1.)).focus(|s|s.opacity(1.)).hover(|s|s.bg(theme.hairline))}
                                on:click={cx.listener(move|this,_,_,cx|this.star(star_path.clone(),cx))}><Icon size={IconSize::Supporting} {..Icon::new("star-icon",if starred{IconName::StarFilled}else{IconName::Star})}/></button>
                            <button id="forget" aria-label={format!("Remove {} from list",forget_path.display())} aria-description="Removes only the saved entry. Your repository folder is kept." class="absolute size-[26px] rounded-[4px] flex items-center justify-center border-1 focus-visible:border-focus-ring"
                                style={|s|s.top(px(10.)).right(px(8.)).when(layout==Layout::Tiles,|s|s.left(px(card_width-62.))).border_color(gpui::transparent_black()).text_color(theme.muted_ink).opacity(0.).group_hover("repository-card",|s|s.opacity(1.)).focus(|s|s.opacity(1.)).hover(|s|s.bg(theme.hairline))}
                                on:click={cx.listener(move|this,_,_,cx|this.forget(&forget_path,cx))}><Icon size={IconSize::Supporting} {..Icon::new("forget-icon",IconName::Broom)}/></button>
                        </div>
                    }.into_any_element()
                    }).collect::<Vec<_>>();

                    gpui::div().id(row).w_full().h(px(if layout==Layout::Tiles{124.}else{58.})).flex().flex_row().gap(px(12.)).children(cards).into_any_element()
                }).collect()
            }).unwrap_or_default()
        }).size_full().min_h_0().min_w_0().track_scroll(&self.scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        list.into_any_element()
    }

    fn folders(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let theme = Theme::current();
        let tiled = self.library.layout == Layout::Tiles;

        rake::view! {
            <div id="home-folders" class="flex gap-3 overflow-y-scroll min-h-0" style={|s|s.when(tiled,|s|s.flex_row().flex_wrap()).when(!tiled,|s|s.flex_col())}>
                <button id="add-folder" aria-label="Add folder" class="shrink-0 rounded-[6px] p-3 flex items-center gap-2 text-muted-ink" style={|s|s.when(tiled,|s|s.w(px(160.)).min_w(px(140.)).max_w(px(180.)).flex_1().h(px(120.)).flex_col().justify_center()).when(!tiled,|s|s.w_full().h(px(76.)).flex_row()).hover(|s|s.bg(theme.hairline))} on:click={cx.listener(|this,_,_,cx|this.pick_folder(cx))}><Icon size={IconSize::Prominent} {..Icon::new("add-icon",IconName::Plus)}/><p class="text-body">{"Add folder…"}</p></button>
                for (index,path) in self.library.folders.iter().enumerate() {
                    <button id={index} aria-label={format!("Open {}",path.display())} class="shrink-0 rounded-[6px] p-3 flex gap-2" style={|s|s.when(tiled,|s|s.w(px(160.)).min_w(px(140.)).max_w(px(180.)).flex_1().h(px(120.)).flex_col().items_start().justify_start().border_1().border_color(theme.line)).when(!tiled,|s|s.w_full().h(px(76.)).flex_row().items_center()).hover(|s|s.bg(theme.hairline))} on:click={cx.listener({let path=path.clone();move |this,_,_,cx|this.folder(path.clone(),cx)})}>
                        <div class="text-accent"><Icon size={IconSize::Folder} {..Icon::new("folder",IconName::LibraryFolder)}/></div>
                        <div class="w-full min-w-0 flex flex-col gap-1"><p class="text-body overflow-hidden whitespace-nowrap">{&path.file_name().unwrap_or(path.as_os_str()).to_string_lossy()}</p><p class="text-small text-muted-ink">{repository_count(self.library.paths.iter().filter(|repository|self.library.owner(repository)==Some(path.as_path())).count())}</p><p class="text-caption text-muted-ink overflow-hidden whitespace-nowrap">{&path.to_string_lossy()}</p></div>
                    </button>
                }
                if self.library.paths.iter().any(|path|self.library.owner(path).is_none()) {
                    <button id="other-folder" aria-label="Open Other repositories" class="shrink-0 rounded-[6px] p-3 flex gap-2" style={|s|s.when(tiled,|s|s.w(px(160.)).min_w(px(140.)).max_w(px(180.)).flex_1().h(px(120.)).flex_col().items_start().justify_start().border_1().border_color(theme.line)).when(!tiled,|s|s.w_full().h(px(76.)).flex_row().items_center()).hover(|s|s.bg(theme.hairline))} on:click={cx.listener(|this,_,_,cx|{this.library.folder=Some(Folder::Other);this.filter(cx);this.persist(cx);})}>
                        <div class="text-accent"><Icon size={IconSize::Folder} {..Icon::new("folder",IconName::LibraryFolder)}/></div><div class="min-w-0 flex flex-col gap-1"><p class="text-body">{"Other repositories"}</p><p class="text-small text-muted-ink">{repository_count(self.library.paths.iter().filter(|path|self.library.owner(path).is_none()).count())}</p></div>
                    </button>
                }
            </div>
        }.into_any_element()
    }
}

impl Render for Home {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let sidebar = self.sidebar(cx);
        let search = self.search(cx);
        let folders = self.library.folder.is_none() && self.query.read(cx).text().trim().is_empty();

        let results = if folders {
            let cards = self.folders(cx);

            let favorites = if self.matches.is_empty() {
                None
            } else {
                Some(self.repositories(cx))
            };

            rake::view! {
                <div class="size-full min-h-0 min-w-0 flex flex-col gap-5">
                    <div class="shrink-0">{cards}</div>
                    if let Some(favorites)=favorites {<div class="flex-1 min-h-0 min-w-0 flex flex-col gap-2"><p class="text-caption text-muted-ink">{"STARRED REPOSITORIES"}</p><div class="flex-1 min-h-0 min-w-0">{favorites}</div></div>}
                </div>
            }.into_any_element()
        } else if self.matches.is_empty() {
            rake::view!{<div class="flex-1 flex flex-col items-center justify-center gap-2 text-muted-ink"><p class="text-body">{if self.query.read(cx).text().trim().is_empty(){"No repositories yet"}else{"No repositories found"}}</p><p class="text-small">{"Open a repository or scan another folder to find projects."}</p></div>}.into_any_element()
        } else {
            self.repositories(cx)
        };

        let measured = cx.weak_entity();

        let measure = gpui::canvas(
            move |bounds, _, cx| {
                let _ = measured.update(cx, |this, cx| {
                    if this.library_width != bounds.size.width {
                        this.library_width = bounds.size.width;
                        cx.notify();
                    }
                });
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();

        let body=rake::view!{
            <div class="size-full min-w-0 min-h-0 flex flex-col items-center p-10" focus={&self.focus}>
                <div class="w-full max-w-[980px] flex-1 min-h-0 flex flex-row gap-16" style={|s|s.debug_selector(||"home-columns".into())}>
                    {sidebar}<div class="relative flex-1 min-w-0 min-h-0 flex flex-col gap-1">{measure}{search}<div class="flex-1 min-h-0 min-w-0">{results}</div></div>
                </div>
            </div>
        }.into_any_element();

        let form = self.form;
        let busy = self.setup_job.is_some();
        let setup = matches!(form, Form::Create | Form::Clone);

        let title = match form {
            Form::Create => "Create repository",
            Form::Clone => "Clone repository",
            Form::Machines => "Remote machines",
            Form::Accounts => "Accounts",
        };

        let footer=rake::view!{
            <div class="flex flex-row justify-end gap-2">
                <Button variant={ButtonVariant::Ghost} state={if busy{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.dialog.update(cx,|dialog,cx|{dialog.close(window,cx);});})))} {..Button::new("cancel",if setup{"Cancel"}else{"Close"})}/>
                if setup {<Button variant={ButtonVariant::Primary} state={if busy{ControlState::Busy}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.submit(window,cx))))} {..Button::new("submit",if form==Form::Create{"Create repository"}else{"Clone repository"})}/>}
            </div>
        }.into_any_element();

        rake::view! {
            <DialogHost state={self.host.clone()} body={body}>
                <Dialog availability={if busy{DialogAvailability::Busy}else{DialogAvailability::Ready}} initial_focus={setup.then(||self.destination.read(cx).focus_handle(cx))} footer={Some(footer)} {..Dialog::new("home-action",&self.dialog,title)}>
                    if setup {
                        <div class="flex flex-col gap-3">
                            if form==Form::Clone {<TextInput availability={if busy{InputAvailability::Disabled}else{InputAvailability::Enabled}} placeholder={"https://github.com/owner/repository.git".into()} {..TextInput::new("clone-url",&self.remote,"Repository URL")}/>}
                            <TextInput availability={if busy{InputAvailability::Disabled}else{InputAvailability::Enabled}} placeholder={"/absolute/path/to/new-repository".into()} {..TextInput::new("setup-destination",&self.destination,"Destination")}/>
                            if let Some(error)=&self.form_error {<Text tone={TextTone::Danger} role={TextRole::Small} {..Text::new("setup-error",error.clone())}/>}
                        </div>
                    }else{<Text tone={TextTone::Muted} {..Text::new("unavailable",if form==Form::Machines{"SSH machine connections are not ported to Rust yet. Saved machine names are shown for reference; use This Mac to browse local repositories."}else{"Hosting account connections are not ported to Rust yet. Git continues to use your configured credential helpers."})}/>}
                </Dialog>
            </DialogHost>
        }
    }
}
