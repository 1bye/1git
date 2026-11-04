use super::{Editor, Page, Panel, Review};
use gpui_ce_motion::{Easing, Transition};

use onegit_ui::{
    Button, ButtonTone, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability,
    DialogKind, DialogPresentation, Icon, IconButton, IconName, IconSize, InputAvailability,
    InputVariant, ListRow, ListRowVariant, RowSelection, TextInput, Theme,
};

use rake::gpui::{self, prelude::*, px};
use std::time::Duration;

// Original Settings glyphs; source license is recorded in PORTING.md.
fn navigation_glyph(page: Page) -> gpui::AnyElement {
    let (name, data): (&str, &'static [u8]) = match page {
        Page::Accounts => ("userCircle", include_bytes!("assets/userCircle.svg")),
        Page::Remotes => ("network", include_bytes!("assets/network.svg")),
        Page::Identity => ("idCard", include_bytes!("assets/idCard.svg")),
        Page::Global => return rake::view! {<Icon size={IconSize::Supporting} {..Icon::new("settings-nav-icon",IconName::Branch)} />}.into_any_element(),
    };

    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            window
                .paint_svg(
                    bounds,
                    format!("onegit-settings/{name}").into(),
                    Some(data),
                    Default::default(),
                    Theme::current().muted_ink,
                    cx,
                )
                .expect("source Settings SVG is valid");
        },
    )
    .w(px(14.))
    .h(px(14.))
    .flex_shrink_0()
    .into_any_element()
}

fn group(title: &str, meta: String, rows: Vec<gpui::AnyElement>) -> gpui::AnyElement {
    let theme = Theme::current();

    rake::view!{<div role={gpui::accesskit::Role::Group} aria-label={title} class="flex flex-col shrink-0 min-w-0 border-1 border-line rounded-[6px] overflow-hidden mb-6">
        <div class="flex flex-row items-center gap-2 px-4 py-3 shrink-0" style={|s|s.bg(theme.hairline)}><p role={gpui::accesskit::Role::Heading} class="text-body font-medium flex-1" style={|s|s.aria_level(2)}>{title}</p><p class="text-small text-muted-ink">{meta}</p></div>
        for (index,row) in rows.into_iter().enumerate() {<div id={index} class="min-w-0 shrink-0">{row}</div>}
    </div>}.into_any_element()
}

fn empty_remotes() -> gpui::AnyElement {
    let drawing = gpui::canvas(
        |_, _, _| {},
        |bounds, _, window, cx| {
            window
                .paint_svg(
                    bounds,
                    "onegit-app/state-repository".into(),
                    Some(include_bytes!("../assets/state-repository.svg")),
                    Default::default(),
                    Theme::current().muted_ink,
                    cx,
                )
                .expect("original repository artwork is valid");
        },
    )
    .w(px(160.))
    .h(px(112.))
    .flex_shrink_0();

    rake::view!{<div class="p-4 flex flex-col items-center gap-2 min-w-0">{drawing}<p class="text-small text-muted-ink">{"No remotes configured."}</p></div>}.into_any_element()
}

impl Panel {
    fn choice(&self, custom: bool, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let theme = Theme::current();
        let selected = self.custom == custom;
        let label = if custom { "Custom" } else { "Default" };

        let detail = if custom {
            "Enter name and email"
        } else {
            "Computer-wide identity"
        };

        rake::view!{
            <button id={if custom{"identity-custom"}else{"identity-default"}} tabindex={0} disabled={self.pending} aria-label={format!("{label}, {detail}")}
                focus={&self.choice_focus[usize::from(custom)]} class="h-[88px] flex-1 min-w-0 flex flex-col items-center justify-center gap-1.5 border-1 rounded-control focus-visible:border-focus-ring"
                style={|s|s.border_color(if selected{if theme.appearance==onegit_ui::Appearance::Dark{gpui::rgb_to_hsla(gpui::rgb(0x4a6080))}else{theme.accent}}else{theme.line}).bg(if selected{theme.hairline}else{gpui::transparent_black()}).aria_toggled(if selected{gpui::accesskit::Toggled::True}else{gpui::accesskit::Toggled::False}).hover(|s|s.bg(theme.hover)).when(self.pending,|s|s.opacity(0.5))}
                on:click={cx.listener(move|this,_,_,cx|{if !this.pending{this.custom=custom;this.error=None;cx.notify();}})}>
                <div style={|s|s.text_color(if selected{theme.focus_ring}else{theme.muted_ink})}><Icon size={IconSize::Choice} {..Icon::new("choice-icon",if custom{IconName::Pencil}else{IconName::RestoreDefaults})}/></div>
                <p class="text-body whitespace-nowrap">{label}</p><p class="text-caption text-muted-ink whitespace-nowrap">{detail}</p>
            </button>
        }.into_any_element()
    }

    fn summary(&mut self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let Some(review) = self.review.clone() else {
            return gpui::Empty.into_any_element();
        };

        let disabled = self.pending || self.editor.is_some() || self.needs_review;

        if self.page == Page::Remotes {
            let Review::Repository(data) = review else {
                return gpui::Empty.into_any_element();
            };

            let mut rows = Vec::new();

            if data.remotes.is_empty() {
                rows.push(empty_remotes());
            }

            for remote in &data.remotes {
                let name = remote.name.clone();
                let edit_name = name.clone();
                let remove_name = name.clone();
                let unsupported = remote.fetch_urls.len() != 1;

                let push = if remote.push_urls != remote.fetch_urls {
                    Some(format!("Push: {}", remote.push_urls.join(", ")))
                } else {
                    None
                };

                rows.push(rake::view!{<div id={name.clone()} class="flex flex-row items-center gap-3 px-4 py-1.5 border-t-1 border-hairline min-w-0 shrink-0">
                    <Icon size={IconSize::Large} {..Icon::new("remote-icon",IconName::Branch)}/><div class="flex flex-col gap-1 min-w-0 flex-1"><p class="text-body">{name}</p><p class="text-small text-muted-ink">{remote.fetch_urls.join(", ")}</p>if let Some(push)=push{<p class="text-small text-muted-ink">{push}</p>}</div>
                    <div class="flex flex-row items-center gap-2 shrink-0"><Button width={Some(px(32.))} variant={ButtonVariant::Ghost} icon={Some(IconName::Pencil)} icon_size={Some(IconSize::Supporting)} accessibility_label={Some("Edit remote".into())} size={ControlSize::Small} state={if disabled||unsupported{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.edit(Editor::Edit(edit_name.clone()),window,cx))))} {..Button::new("edit","")}/>
                    <Button width={Some(px(32.))} variant={ButtonVariant::Ghost} icon={Some(IconName::Trash)} icon_size={Some(IconSize::Supporting)} accessibility_label={Some("Remove remote".into())} tone={ButtonTone::Danger} size={ControlSize::Small} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.remove(remove_name.clone(),window,cx))))} {..Button::new("remove","")}/></div>
                </div>}.into_any_element());
            }

            let count = data.remotes.len();

            let card = group(
                "Remotes",
                format!("{count} {}", if count == 1 { "remote" } else { "remotes" }),
                rows,
            );

            return rake::view!{<div class="flex flex-col min-w-0">{card}if data.remotes.iter().any(|r|r.fetch_urls.len()!=1){<p class="text-small text-muted-ink">{"Remotes with multiple fetch URLs must be edited in Git directly."}</p>}</div>}.into_any_element();
        }

        let theme = Theme::current();
        let identity = review.identity();

        let initials = identity
            .name
            .as_deref()
            .unwrap_or("")
            .split_whitespace()
            .take(2)
            .filter_map(|s| s.chars().next())
            .collect::<String>()
            .to_uppercase();

        let readonly = match &review {
            Review::Repository(data) => data.identity_read_only_reason.clone(),
            _ => None,
        };

        let row=rake::view!{<div class="flex flex-row items-center gap-3 px-4 py-1.5 border-t-1 border-hairline min-w-0 shrink-0">
            <div class="size-8 rounded-full flex items-center justify-center shrink-0 text-body font-medium" style={|s|s.bg(theme.hairline)}>{if initials.is_empty(){"?".into()}else{initials}}</div>
            <div class="flex flex-col min-w-0 flex-1"><p class="text-body">{identity.name.clone().filter(|s|!s.is_empty()).unwrap_or_else(||"Name not configured".into())}</p><p class="text-small text-muted-ink">{identity.email.clone().filter(|s|!s.is_empty()).unwrap_or_else(||"Email not configured".into())}</p></div>
            if self.page==Page::Identity&&!review.custom(){<p class="text-small text-muted-ink">{"Default identity"}</p>}
            <Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if disabled||readonly.is_some(){ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.edit(Editor::Identity,window,cx))))} {..Button::new("identity-edit","Edit")}/>
        </div>}.into_any_element();

        let card = group("Identity", String::new(), vec![row]);

        rake::view!{<div class="flex flex-col min-w-0">{card}if let Some(reason)=readonly{<p class="text-small text-muted-ink">{reason}</p>}</div>}.into_any_element()
    }

    fn editor_view(&mut self, width: f32, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let Some(editor) = self.editor.clone() else {
            return gpui::Empty.into_any_element();
        };

        let identity = editor == Editor::Identity;

        let title = if identity {
            "Edit commit identity"
        } else if editor == Editor::Add {
            "Add remote"
        } else {
            "Edit remote"
        };

        let availability = if self.pending {
            InputAvailability::Disabled
        } else {
            InputAvailability::Enabled
        };

        let state = if self.pending || self.page == Page::Accounts && self.accounts.read(cx).busy()
        {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };

        let valid = !identity
            || !self.custom
            || (!self.name.read(cx).text().trim().is_empty()
                && !self.email.read(cx).text().trim().is_empty());

        let ready = !self.pending && !self.needs_review && self.changed(cx) && valid;
        let theme = Theme::current();

        rake::view!{<div role={gpui::accesskit::Role::Region} aria-label={title} class="shrink-0 h-full flex flex-col min-w-0 overflow-hidden border-l-1 border-line" style={|s|s.w(px(width)).debug_selector(||"git-settings-editor".into())}>
            <div class="p-4 shrink-0"><p role={gpui::accesskit::Role::Heading} class="text-body font-medium" style={|s|s.aria_level(2)}>{title}</p></div>
            <div id="editor-scroll" class="flex-1 min-h-0 min-w-0 px-4 pb-4 overflow-y-scroll" style={|s|s.track_scroll(&self.editor_scroll)}><div class="flex flex-col gap-3 min-w-0 max-w-[480px]">
                if identity{
                    <div role={gpui::accesskit::Role::Group} aria-label="Identity source" class="flex flex-row gap-2 min-w-0">
                        if self.page!=Page::Global{{self.choice(false,cx)}}
                        {self.choice(true,cx)}
                    </div>
                    if self.custom{
                        <div class="flex flex-col gap-2"><p class="text-body">{"Name"}</p><TextInput show_label={false} variant={InputVariant::Surface} size={ControlSize::Medium} availability={availability} {..TextInput::new("identity-name",&self.name,"Name")}/></div>
                        <div class="flex flex-col gap-2"><p class="text-body">{"Commit email"}</p><TextInput show_label={false} variant={InputVariant::Surface} size={ControlSize::Medium} availability={availability} {..TextInput::new("identity-email",&self.email,"Commit email")}/></div>
                    }
                }else{
                    <div class="flex flex-col gap-2"><p class="text-body">{"Remote name"}</p><TextInput show_label={false} variant={InputVariant::Surface} size={ControlSize::Medium} availability={if editor==Editor::Add{availability}else{InputAvailability::ReadOnly}} {..TextInput::new("remote-name",&self.remote_name,"Remote name")}/></div>
                    <div class="flex flex-col gap-2"><p class="text-body">{"Remote URL"}</p><TextInput show_label={false} variant={InputVariant::Surface} size={ControlSize::Medium} availability={availability} {..TextInput::new("remote-url",&self.remote_url,"Remote URL")}/></div>
                }
            </div></div>
            <div class="p-4 border-t-1 border-line flex flex-col gap-2 shrink-0 min-w-0"><div class="max-w-[480px] w-full flex flex-col gap-2 min-w-0">
                if let Some(error)=&self.error{<div id="settings-error" class="max-h-[96px] overflow-y-scroll shrink-0"><p role={gpui::accesskit::Role::Alert} class="text-small" style={|s|s.text_color(theme.danger)}>{error.clone()}</p></div>}
                if self.page==Page::Global{<p class="text-small text-muted-ink">{"Changes the default identity for repositories on this computer."}</p>}
                <div class="flex flex-row items-center justify-between gap-3 w-full">
                    <Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={state} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.cancel(window,cx))))} {..Button::new("settings-cancel","Cancel")}/>
                    <Button size={ControlSize::Small} state={if self.pending{ControlState::Busy}else if ready{ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.save(cx))))} {..Button::new("settings-save",if identity{"Save identity"}else{"Save remote"})}/>
                </div>
            </div></div>
        </div>}.into_any_element()
    }
}

impl gpui::Render for Panel {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        if !self.visible {
            return gpui::Empty.into_any_element();
        }

        let theme = Theme::current();

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        self.reveal.animate(
            if self.editor.is_some() { 1. } else { 0. },
            Transition::Tween(Duration::from_millis(160), Easing::EaseOut),
            time,
        );
        let reveal = self.reveal.sample(time, cx.reduce_motion());

        if reveal.is_animating() {
            window.request_animation_frame();
        }

        let width =
            (f32::from(window.viewport_size().width) - 254.).max(0.) / 2. * reveal.value() as f32;

        let summary = self.summary(cx);
        let editor = self.editor_view(width, cx);

        let title = match self.page {
            Page::Accounts => "Accounts",
            Page::Global => "Git",
            Page::Identity => "Commit identity",
            Page::Remotes => "Remotes",
        };

        let state = if self.pending || self.page == Page::Accounts && self.accounts.read(cx).busy()
        {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };

        let panel=rake::view!{<div class="absolute left-[48px] top-[42px] right-[6px] bottom-[6px] overflow-hidden flex flex-row" focus={&self.focus} tab-navigation={true} style={|s|s.bg(theme.surface).text_color(theme.ink).rounded_tl(px(14.)).occlude().debug_selector(||"git-settings".into()).on_key_down(cx.listener(|this,event:&gpui::KeyDownEvent,window,cx|{if event.keystroke.key=="escape"{if this.page==Page::Accounts&&this.accounts.read(cx).editing(){this.accounts.update(cx,|a,cx|a.cancel(window,cx));}else if this.editor.is_some(){this.cancel(window,cx);}else{this.close(window,cx);}cx.stop_propagation();}}))}>
            <div class="absolute right-2 top-2"><IconButton state={state} size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close(window,cx))))} {..IconButton::new("settings-close",IconName::Close,"Close Git settings")}/></div>
            <nav aria-label="Git settings navigation" class="w-[200px] shrink-0 border-r-1 border-line p-2 flex flex-col gap-1.5">

                <p class="text-caption text-muted-ink px-2.5 mt-3">{"Application"}</p>
                <ListRow leading={Some(navigation_glyph(Page::Accounts))} variant={ListRowVariant::Compact} state={state} selection={if self.page==Page::Accounts{RowSelection::Selected}else{RowSelection::Unselected}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose(Page::Accounts,cx))))} {..ListRow::new("settings-accounts","Accounts")}/>
                <ListRow leading={Some(rake::view!{<div class="text-muted-ink"><Icon size={IconSize::Supporting} {..Icon::new("settings-nav-icon",IconName::Branch)} /></div>}.into_any_element())} variant={ListRowVariant::Compact} state={state} selection={if self.page==Page::Global{RowSelection::Selected}else{RowSelection::Unselected}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose(Page::Global,cx))))} {..ListRow::new("settings-global","Git")}/>
                if self.source.is_some(){
                    <p class="text-caption text-muted-ink px-2.5 mt-5">{"Repository"}</p>
                    <ListRow leading={Some(navigation_glyph(Page::Remotes))} variant={ListRowVariant::Compact} state={state} selection={if self.page==Page::Remotes{RowSelection::Selected}else{RowSelection::Unselected}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose(Page::Remotes,cx))))} {..ListRow::new("settings-remotes","Remotes")}/>
                    <ListRow leading={Some(navigation_glyph(Page::Identity))} variant={ListRowVariant::Compact} state={state} selection={if self.page==Page::Identity{RowSelection::Selected}else{RowSelection::Unselected}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose(Page::Identity,cx))))} {..ListRow::new("settings-identity","Commit identity")}/>
                }
            </nav>
            if self.page==Page::Accounts {{self.accounts.clone()}}else{
            <div class="flex-1 min-w-0 h-full flex flex-row">
                <div class="flex-1 min-w-0 h-full flex flex-col">
                    <div class="p-4 pb-5 flex flex-col gap-1 max-w-[512px] w-full shrink-0">
                        <div class="flex flex-row items-center justify-between gap-3 min-w-0"><p role={gpui::accesskit::Role::Heading} class="text-title font-medium" style={|s|s.aria_level(1)}>{title}</p>
                            if self.page==Page::Remotes&&self.review.is_some(){<Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if self.pending||self.editor.is_some()||self.needs_review{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.edit(Editor::Add,window,cx))))} {..Button::new("remote-add","Add remote")}/>}
                        </div>

                    </div>
                    <div id="settings-scroll" class="flex-1 min-h-0 overflow-y-scroll px-4 pb-4 max-w-[512px] w-full" style={|s|s.track_scroll(&self.scroll)}>
                        {summary}
                        if self.read.is_some(){<p class="text-small text-muted-ink">{"Reading Git settings…"}</p>}
                        if self.editor.is_none(){if let Some(error)=&self.error{<div id="settings-error" class="max-h-[96px] overflow-y-scroll shrink-0"><p role={gpui::accesskit::Role::Alert} class="text-small" style={|s|s.text_color(theme.danger)}>{error.clone()}</p></div>}}
                        if let Some(notice)=&self.notice{<p role={gpui::accesskit::Role::Status} class="text-small text-muted-ink">{notice.clone()}</p>}
                        if self.needs_review&&self.editor.is_none(){<Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={state} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.load(cx))))} {..Button::new("settings-reload","Reload Git settings")}/>}
                    </div>
                </div>
                {editor}
            </div>
            }
        </div>}.into_any_element();

        let removing = self.removing.clone();

        let remove_time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.remove_epoch);

        let transition = Transition::Tween(Duration::from_millis(160), Easing::EaseOut);

        self.remove_height.animate(
            if self.error.is_some() { 218. } else { 122. },
            transition,
            remove_time,
        );
        self.remove_opacity.animate(1., transition, remove_time);
        let remove_height = self.remove_height.sample(remove_time, cx.reduce_motion());
        let remove_opacity = self.remove_opacity.sample(remove_time, cx.reduce_motion());

        if removing.is_some() && (remove_height.is_animating() || remove_opacity.is_animating()) {
            window.request_animation_frame();
        }

        let confirmation = if let Some(name) = removing {
            rake::view!{
            <Dialog width={px(340.)} kind={DialogKind::Confirmation} presentation={DialogPresentation::Compact{height:px(remove_height.value() as f32)}} availability={if self.pending{DialogAvailability::Busy}else{DialogAvailability::Ready}} initial_focus={Some(self.cancel_focus.clone())} {..Dialog::new("remove-remote",&self.dialog,"Confirm remote removal")}>
                <div class="flex flex-col gap-2 p-2 min-w-0" style={|s|s.opacity(remove_opacity.value() as f32).debug_selector(||"git-settings-remove".into())}><p role={gpui::accesskit::Role::Heading} class="text-body font-medium" style={|s|s.aria_level(2)}>{format!("Remove {name}?")}</p><p class="text-small text-muted-ink">{"Removes the connection, its remote-tracking references and tracking configuration. Your local files, local branches, and hosted repository remain unchanged."}</p>
                    if let Some(error)=&self.error{<div id="settings-error" class="max-h-[96px] overflow-y-scroll shrink-0"><p role={gpui::accesskit::Role::Alert} class="text-small" style={|s|s.text_color(theme.danger)}>{error.clone()}</p></div>}
                    <div class="flex flex-row justify-end gap-2">
                        <Button focus={Some(self.cancel_focus.clone())} size={ControlSize::Small} variant={ButtonVariant::Secondary} state={state} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.dialog.update(cx,|dialog,cx|dialog.close(window,cx));this.removing=None;if this.needs_review{this.load(cx);}cx.notify();})))} {..Button::new("remote-remove-cancel","Cancel")}/>
                        <Button size={ControlSize::Small} variant={ButtonVariant::Secondary} tone={ButtonTone::Danger} state={if self.pending{ControlState::Busy}else if self.needs_review{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(move|this,_,_,cx|this.submit(onegit_git::SettingsChange::RemoveRemote{name:name.clone()},cx))))} {..Button::new("remote-remove-confirm","Remove remote")}/>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
        } else {
            gpui::Empty.into_any_element()
        };

        rake::view! {<div class="absolute inset-0">{panel}{confirmation}</div>}.into_any_element()
    }
}
