//! Native account settings uses the source split-pane geometry, provider tiles and setup guidance.
use super::{
    model::*,
    panel::{Method, Panel},
};

use gpui_ce_motion::{Easing, Transition};

use onegit_ui::{
    Button, ButtonTone, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState, Dialog,
    DialogAvailability, DialogKind, DialogPresentation, IconName, IconSize, InputAvailability,
    InputVariant, PasswordInput, TextInput, Theme,
};

use rake::gpui::{self, prelude::*, px};
use std::time::Duration;

fn glyph(name: &'static str, size: f32, color: gpui::Hsla) -> gpui::AnyElement {
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let data: &'static [u8] = match name {
                "github" => include_bytes!("assets/github.svg"),
                "gitlab" => include_bytes!("assets/gitlab.svg"),
                "browser" => include_bytes!("assets/browser.svg"),
                "key" => include_bytes!("assets/key.svg"),
                "other" => include_bytes!("assets/other.svg"),
                _ => include_bytes!("assets/empty.svg"),
            };

            window
                .paint_svg(
                    bounds,
                    format!("onegit-accounts/{name}").into(),
                    Some(data),
                    Default::default(),
                    color,
                    cx,
                )
                .expect("source account SVG is valid");
        },
    )
    .w(px(size))
    .h(px(if name == "empty" { 112. } else { size }))
    .flex_shrink_0()
    .into_any_element()
}

fn error(value: &str) -> gpui::AnyElement {
    rake::view!{<div id="account-error" class="max-h-[96px] overflow-y-scroll shrink-0"><p role={gpui::accesskit::Role::Alert} class="text-small" style={|s|s.text_color(Theme::current().danger)}>{value}</p></div>}.into_any_element()
}

struct Choice<'a> {
    id: &'static str,
    label: &'a str,
    icon: &'static str,
    selected: bool,
    disabled: bool,
    focus: usize,
}

impl Panel {
    fn tile(
        &self,
        choice: Choice<'_>,
        action: impl Fn(&mut Self, &mut gpui::Context<Self>) + 'static,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let Choice {
            id,
            label,
            icon,
            selected,
            disabled,
            focus,
        } = choice;

        let theme = Theme::current();

        let drawing = glyph(
            icon,
            22.,
            if selected {
                theme.focus_ring
            } else {
                theme.muted_ink
            },
        );

        rake::view!{<button id={id} tabindex={0} disabled={disabled} focus={&self.choice_focus[focus]} aria-label={label.to_string()} class="h-[64px] flex-1 min-w-0 flex flex-col items-center justify-center gap-1.5 border-1 rounded-control focus-visible:border-focus-ring" style={|s|s.border_color(if selected{if theme.appearance==onegit_ui::Appearance::Dark{gpui::rgb_to_hsla(gpui::rgb(0x4a6080))}else{theme.accent}}else{theme.line}).bg(if selected{theme.hairline}else{gpui::transparent_black()}).aria_toggled(if selected{gpui::accesskit::Toggled::True}else{gpui::accesskit::Toggled::False}).hover(|s|s.bg(theme.hover)).when(disabled,|s|s.opacity(0.5))} on:click={cx.listener(move|this,_,_,cx|{if !disabled{action(this,cx);}})}>{drawing}<p class="text-body whitespace-nowrap">{label}</p></button>}.into_any_element()
    }

    fn list(&mut self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let theme = Theme::current();

        let accounts = self
            .review
            .as_ref()
            .map(|r| r.accounts.clone())
            .unwrap_or_default();

        let count = accounts.len();
        let disabled = self.pending || self.form;

        let rows=accounts.into_iter().map(|account| {
            let key=account.key();let status=self.status.get(&key).map_or("Not checked",String::as_str);let detail=format!("{} · {}{status}",account.host_label(),if account.credential_source.as_deref()==Some("github-cli"){"GitHub CLI · "}else{""});let icon=glyph(account.provider.id(),22.,theme.muted_ink);let check=account.clone();let reconnect=account.clone();let remove=account.clone();let identity=format!("{} on {}",account.username,account.host_label());

            rake::view!{<div id={key} role={gpui::accesskit::Role::Group} aria-label={format!("{} · {}",account.username,account.provider.label())} class="flex flex-row items-center gap-3 px-4 py-1.5 border-t-1 border-hairline min-w-0 shrink-0">{icon}<div class="flex flex-col gap-0.5 min-w-0 flex-1"><p class="text-body">{account.username}</p><p class="text-small text-muted-ink">{detail}</p></div><div class="flex flex-row items-center gap-1 shrink-0">
                <Button width={Some(px(26.))} height={Some(px(26.))} size={ControlSize::Small} variant={ButtonVariant::Ghost} tone={ButtonTone::Muted} icon={Some(IconName::RestoreDefaults)} icon_size={Some(IconSize::Supporting)} accessibility_label={Some(format!("Check connection for {identity}").into())} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(move|this,_,_,cx|this.check(check.clone(),cx))))} {..Button::new("check","")}/>
                <Button width={Some(px(26.))} height={Some(px(26.))} size={ControlSize::Small} variant={ButtonVariant::Ghost} tone={ButtonTone::Muted} icon={Some(IconName::Pencil)} icon_size={Some(IconSize::Supporting)} accessibility_label={Some(format!("Reconnect {identity}").into())} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.begin(Some(reconnect.clone()),window,cx))))} {..Button::new("reconnect","")}/>
                <Button width={Some(px(26.))} height={Some(px(26.))} size={ControlSize::Small} variant={ButtonVariant::Ghost} tone={ButtonTone::Danger} icon={Some(IconName::Trash)} icon_size={Some(IconSize::Supporting)} accessibility_label={Some(format!("Remove {identity}").into())} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.remove(remove.clone(),window,cx))))} {..Button::new("remove","")}/>
            </div></div>}.into_any_element()
        }).collect::<Vec<_>>();

        let empty = glyph("empty", 160., theme.muted_ink);

        rake::view!{<div class="flex flex-col min-w-0 shrink-0 border-1 border-line rounded-[6px] overflow-hidden">
            <div class="flex flex-row items-center gap-2 px-4 py-3 shrink-0" style={|s|s.bg(theme.hairline)}><p role={gpui::accesskit::Role::Heading} class="text-body font-medium flex-1" style={|s|s.aria_level(2)}>{"Connected accounts"}</p><p class="text-small text-muted-ink">{format!("{count} {}",if count==1{"account"}else{"accounts"})}</p></div>
            if count==0 {<div class="p-4 flex flex-col items-center gap-2 min-w-0">{empty}<p class="text-body font-medium">{"No accounts connected."}</p><p class="text-small text-muted-ink">{"Add an account to connect your hosting provider."}</p></div>}
            for (index,row) in rows.into_iter().enumerate() {<div id={index} class="min-w-0 shrink-0">{row}</div>}
        </div>}.into_any_element()
    }

    fn field(
        &self,
        input: &gpui::Entity<onegit_ui::InputState>,
        id: &'static str,
        label: &str,
        placeholder: &str,
        read_only: bool,
    ) -> gpui::AnyElement {
        rake::view!{<div id={id} class="flex flex-col gap-1.5 shrink-0" style={|s|s.debug_selector(move||format!("account-field-{id}"))}><p class="text-body">{label}</p><TextInput show_label={false} height={Some(px(28.))} variant={InputVariant::Surface} availability={if self.form_locked(){InputAvailability::Disabled}else if read_only{InputAvailability::ReadOnly}else{InputAvailability::Enabled}} placeholder={placeholder.to_string().into()} {..TextInput::new(id,input,label)}/></div>}.into_any_element()
    }

    fn copy_value(
        &self,
        key: &'static str,
        label: &str,
        value: &str,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let copy = value.to_string();
        let disabled = self.pending;

        rake::view!{<div id={key} class="flex flex-col gap-1 shrink-0" style={|s|s.debug_selector(move||format!("account-setup-value-{key}"))}><p class="text-body">{label}</p><div class="min-h-[32px] border-1 border-line rounded-control pl-2.5 pr-1 flex flex-row items-center gap-2"><p class="text-small flex-1 min-w-0 overflow-hidden whitespace-nowrap">{value}</p><Button width={Some(px(58.))} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} accessibility_label={Some(format!("Copy {label}").into())} on_press={Some(Box::new(cx.listener(move|this,_,_,cx|{cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone()));this.copied=Some(key);cx.notify();})))} {..Button::new(key,if self.copied==Some(key){"Copied"}else{"Copy"})}/></div></div>}.into_any_element()
    }

    fn guide(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let manual = self.method == Method::Token;
        let host = Host::new(self.provider, self.host.read(cx).text()).ok();
        let url = host.map(|host| host.setup_url(manual, self.repositories).to_string());
        let enabled = !self.pending && url.is_some();
        let provider = self.provider;

        let name = self.copy_value(
            "name",
            if manual {
                "Token name"
            } else {
                "Application name"
            },
            "1git",
            cx,
        );

        let homepage = self.copy_value("homepage", "Homepage URL", HOMEPAGE, cx);

        let callback_value = if provider == Provider::GitHub {
            CALLBACK.to_string()
        } else {
            self.callback.read(cx).text().to_string()
        };

        let callback = self.copy_value(
            "callback",
            if provider == Provider::GitHub {
                "Callback URL"
            } else {
                "Redirect URI"
            },
            &callback_value,
            cx,
        );

        let hint = if manual {
            match (provider, self.repositories) {
                (Provider::GitHub, true) => {
                    "Use a fine-grained token with access to your chosen repositories and Contents: Read-only. Choose an expiry date; organization approval or SSO may be required."
                }
                (Provider::GitHub, false) => {
                    "Use a fine-grained token with an expiry date. Keep repository access public-only; no extra permissions are needed for account connection."
                }
                (Provider::GitLab, true) => {
                    "Choose an expiry date and select read_user, read_api and read_repository."
                }
                (Provider::GitLab, false) => {
                    "Choose an expiry date and select only read_user, then create the token."
                }
            }
        } else {
            match (provider, self.repositories) {
                (Provider::GitHub, _) => "Enable Device Flow, then register the application.",
                (Provider::GitLab, true) => {
                    "Uncheck Confidential; enable read_user, read_api and read_repository, then save the application."
                }
                (Provider::GitLab, false) => {
                    "Uncheck Confidential, select read_user, then save the application."
                }
            }
        };

        rake::view!{<div class="flex flex-col gap-1 shrink-0"><p class="text-body">{if manual{"Token setup"}else{"Application setup"}}</p><div class="flex flex-col gap-1 shrink-0"><div class="flex flex-row items-center justify-between gap-2"><p class="text-small text-muted-ink flex-1 min-w-0">{if manual{"Create a token using the details below."}else{"Register an OAuth app using these values."}}</p><Button variant={ButtonVariant::Secondary} size={ControlSize::Small} state={if enabled{ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener(move|_,_,_,cx|{if let Some(url)=&url{cx.open_url(url);}})))} {..Button::new("setup-open",format!("Open {} settings",provider.label()))}/></div>{name}if !manual{if provider==Provider::GitHub{{homepage}}{callback}}<p class="text-small text-muted-ink">{hint}</p></div></div>}.into_any_element()
    }

    fn fields(&mut self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let disabled = self.form_locked();
        let fixed = disabled || self.replacing.is_some();

        let github = self.tile(
            Choice {
                id: "provider-github",
                label: "GitHub",
                icon: "github",
                selected: self.provider == Provider::GitHub,
                disabled: fixed,
                focus: 0,
            },
            |this, cx| this.provider(Provider::GitHub, cx),
            cx,
        );

        let gitlab = self.tile(
            Choice {
                id: "provider-gitlab",
                label: "GitLab",
                icon: "gitlab",
                selected: self.provider == Provider::GitLab,
                disabled: fixed,
                focus: 1,
            },
            |this, cx| this.provider(Provider::GitLab, cx),
            cx,
        );

        let other=self.tile(Choice{id:"provider-other",label:"Other…",icon:"other",selected:false,disabled:fixed,focus:2},|_,cx|cx.open_url("https://github.com/1bye/1git/issues/new?title=Hosting%20provider%20request&body=Provider%20name%20and%20host%3A%0A%0AContributions%20are%20welcome%3A%20add%20a%20provider%20in%20packages%2Fhosting%2Fsrc%2Fproviders."),cx);

        let browser = self.tile(
            Choice {
                id: "method-browser",
                label: "Browser",
                icon: "browser",
                selected: self.method == Method::Browser,
                disabled,
                focus: 3,
            },
            |this, cx| this.method(Method::Browser, cx),
            cx,
        );

        let token = self.tile(
            Choice {
                id: "method-token",
                label: "Access token",
                icon: "key",
                selected: self.method == Method::Token,
                disabled,
                focus: 4,
            },
            |this, cx| this.method(Method::Token, cx),
            cx,
        );

        let cli = self.tile(
            Choice {
                id: "method-cli",
                label: "GitHub CLI",
                icon: "github",
                selected: self.method == Method::Cli,
                disabled,
                focus: 5,
            },
            |this, cx| this.method(Method::Cli, cx),
            cx,
        );

        let guide = self.guide(cx);

        let client = self.field(
            &self.client,
            "account-client",
            if self.provider == Provider::GitHub {
                "Client ID"
            } else {
                "Application ID"
            },
            if self.provider == Provider::GitHub {
                "Client ID"
            } else {
                "Application ID"
            },
            false,
        );

        let host = self.field(
            &self.host,
            "account-host",
            "Host URL",
            "https://github.com",
            self.replacing.is_some(),
        );

        let callback = self.field(
            &self.callback,
            "account-callback",
            "Registered callback URL",
            CALLBACK,
            false,
        );

        let access = if self.repositories {
            if self.provider == Provider::GitHub {
                "GitHub OAuth's repo scope grants read and write access. For selected repositories with read-only access, use a fine-grained token instead."
            } else {
                "Requests read-only API and Git access. Enable read_user, read_api and read_repository on your application or token."
            }
        } else {
            "Profile-only sign-in. GitHub can list public repositories; GitLab repository browsing needs read_api."
        };

        let cli_tiles=self.cli_accounts.iter().enumerate().map(|(index,account)| {let name=account.username.clone();let detail=format!("{} · {}",account.host,if self.cli_selected==Some(index){"Selected"}else{"Select"});

            rake::view!{<button id={format!("cli-{}-{}",account.host,account.username)} tabindex={0} disabled={disabled} aria-label={format!("Select {} on {}",account.username,account.host)} class="w-full h-[88px] border-1 rounded-control flex flex-col items-center justify-center gap-1.5" style={|s|s.border_color(if self.cli_selected==Some(index){Theme::current().focus_ring}else{Theme::current().line}).bg(if self.cli_selected==Some(index){Theme::current().hairline}else{gpui::transparent_black()}).hover(|s|s.bg(Theme::current().hover))} on:click={cx.listener(move|this,_,_,cx|{if !this.pending{this.cli_selected=Some(index);cx.notify();}})}>{glyph("github",22.,Theme::current().muted_ink)}<p class="text-body">{name}</p><p class="text-caption text-muted-ink">{detail}</p></button>}.into_any_element()}).collect::<Vec<_>>();

        let mut cli_rows: Vec<Vec<gpui::AnyElement>> = Vec::new();

        for (index, tile) in cli_tiles.into_iter().enumerate() {
            if index % 2 == 0 {
                cli_rows.push(Vec::new());
            }

            cli_rows.last_mut().expect("CLI row initialized").push(tile);
        }

        rake::view!{<div class="flex flex-col gap-3 max-w-[480px] w-full shrink-0">
            <div class="flex flex-col gap-1 shrink-0"><p class="text-body">{"Provider"}</p><div role={gpui::accesskit::Role::Group} aria-label="Hosting provider" class="flex flex-row gap-2">{github}{gitlab}{other}</div></div>
            <div class="flex flex-col gap-1 shrink-0"><p class="text-body">{"Connect with"}</p><div role={gpui::accesskit::Role::Group} aria-label="Connection method" class="flex flex-row gap-2">{browser}{token}if self.provider==Provider::GitHub{{cli}}</div></div>
            if self.method==Method::Cli {
                <div class="flex flex-col gap-1 shrink-0"><p class="text-body">{"Select a GitHub account"}</p><p class="text-small text-muted-ink">{self.cli_selected.and_then(|i|self.cli_accounts.get(i)).map_or_else(||"Select an account below to enable “Connect with GitHub CLI”.".into(),|a|format!("Ready to connect as {}. Click “Connect with GitHub CLI” below.",a.username))}</p>
                    if self.cli_loading{<p class="text-small text-muted-ink">{"Finding GitHub CLI accounts…"}</p>}
                    if let Some(e)=&self.cli_error{{error(e)}}
                    if !self.cli_loading&&self.cli_error.is_none()&&self.cli_accounts.is_empty(){<p class="text-small text-muted-ink">{"No signed-in accounts found. Run gh auth login in your terminal, then refresh."}</p>}
                    <div role={gpui::accesskit::Role::Group} aria-label="GitHub CLI accounts" class="flex flex-col gap-2">for (index,row) in cli_rows.into_iter().enumerate(){<div id={index} class="flex flex-row gap-2 shrink-0">for (column,tile) in row.into_iter().enumerate(){<div id={column} class="flex-1 min-w-0">{tile}</div>}</div>}</div><p class="text-small text-muted-ink">{"GitHub CLI keeps managing your credentials and permissions."}</p>
                    <Button variant={ButtonVariant::Ghost} size={ControlSize::Small} state={if self.pending||self.cli_loading{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.discover(cx))))} {..Button::new("cli-refresh","Refresh accounts")}/>
                </div>
            }else{
                {guide}
                if self.method==Method::Token {
                    <div class="flex flex-col gap-1.5 shrink-0"><p class="text-body">{"Access token"}</p><PasswordInput show_label={false} variant={InputVariant::Surface} height={Some(px(28.))} placeholder={"Paste an access token".into()} availability={if disabled{InputAvailability::Disabled}else{InputAvailability::Enabled}} {..PasswordInput::new("account-token",&self.token,"Access token")}/><p class="text-small text-muted-ink">{if cfg!(target_os="macos"){"Stored securely in macOS Keychain."}else{"Stored securely in the OS credential store."}}</p></div>
                }else{<div class="flex flex-col gap-1.5 shrink-0">{client}<p class="text-small text-muted-ink">{"Use the public ID, not the client secret."}</p></div>}
                <div class="flex flex-col gap-1 shrink-0"><p class="text-body">{"Repository access"}</p><Checkbox checked={if self.repositories{CheckState::Checked}else{CheckState::Unchecked}} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} on_change={Some(Box::new(cx.listener(|this,checked,_,cx|{this.repositories=*checked==CheckState::Checked;cx.notify();})))} {..Checkbox::new("account-access","Browse and clone private repositories")}/><p class="text-small text-muted-ink">{access}</p></div>
                if self.pending&&self.method==Method::Browser{<p class="text-body">{self.device.as_ref().map_or_else(||if self.waiting{"Waiting for authorization…".into()}else{"Verifying account…".into()},|code|format!("Enter {code} in your browser to authorize 1git."))}</p>}
                if let Some(code)=&self.device{<p role={gpui::accesskit::Role::Status} class="text-heading">{code.clone()}</p>}
                <Button variant={ButtonVariant::Ghost} size={ControlSize::Small} icon={Some(if self.advanced{IconName::ChevronDown}else{IconName::ChevronRight})} state={if disabled{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.advanced = !this.advanced;cx.notify();})))} {..Button::new("account-advanced","Advanced")}/>
                if self.advanced{{host}<p class="text-small text-muted-ink">{"For GitHub Enterprise or self-managed GitLab. Register on this host."}</p>if self.provider==Provider::GitLab&&self.method==Method::Browser{{callback}}}
            }
        </div>}.into_any_element()
    }
}

impl gpui::Render for Panel {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        self.reveal.animate(
            if self.form { 1. } else { 0. },
            Transition::Tween(Duration::from_millis(160), Easing::EaseOut),
            time,
        );
        let sample = self.reveal.sample(time, cx.reduce_motion());

        if sample.is_animating() {
            window.request_animation_frame();
        }

        let width =
            (f32::from(window.viewport_size().width) - 254.).max(0.) / 2. * sample.value() as f32;

        let list = self.list(cx);

        let fields = if self.form {
            self.fields(cx)
        } else {
            gpui::Empty.into_any_element()
        };

        let ready = !self.form_locked()
            && (self.method == Method::Cli
                || Host::new(self.provider, self.host.read(cx).text()).is_ok())
            && match self.method {
                Method::Cli => !self.cli_loading && self.cli_selected.is_some(),
                Method::Token => !self.token.read(cx).text().is_empty(),
                Method::Browser => !self.client.read(cx).text().trim().is_empty(),
            };

        let body=rake::view!{<div class="flex-1 min-w-0 h-full flex flex-row" style={|s|s.debug_selector(||"accounts-settings".into())}>
            <div class="flex-1 min-w-0 h-full flex flex-col"><div class="p-4 pb-5 flex flex-col gap-1 max-w-[512px] w-full shrink-0"><div class="flex flex-row items-center justify-between gap-3"><p role={gpui::accesskit::Role::Heading} class="text-title font-medium" style={|s|s.aria_level(1)}>{"Accounts"}</p><Button focus={Some(self.add_focus.clone())} variant={ButtonVariant::Secondary} size={ControlSize::Small} state={if self.pending||self.form||self.loading||self.review.is_none(){ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.begin(None,window,cx))))} {..Button::new("account-add","Add account")}/></div><p class="text-small text-muted-ink">{"Connected hosting accounts."}</p></div>
                <div id="accounts-list-scroll" class="flex-1 min-h-0 overflow-y-scroll px-4 pb-4 max-w-[512px] w-full" style={|s|s.track_scroll(&self.scroll)}>
                    if !self.form&&self.removing.is_none(){if let Some(e)=&self.error{{error(e)}}}
                    if self.loading{<p class="text-small text-muted-ink">{"Reading accounts…"}</p>}else{{list}}
                    if self.review.is_none()&&!self.loading{<Button size={ControlSize::Small} variant={ButtonVariant::Secondary} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.load(cx))))} {..Button::new("accounts-reload","Reload accounts")}/>}
                </div>
            </div>
            if self.form {<div role={gpui::accesskit::Role::Group} aria-label={if self.replacing.is_some(){"Reconnect account"}else{"Add account"}} class="h-full shrink-0 min-w-0 overflow-hidden border-l-1 border-line flex flex-col" style={|s|s.w(px(width)).debug_selector(||"account-editor".into())}>
                <div class="p-4 pb-4 flex flex-col gap-1 shrink-0"><p role={gpui::accesskit::Role::Heading} class="text-body font-medium" style={|s|s.aria_level(2)}>{if self.replacing.is_some(){"Reconnect account"}else{"Add account"}}</p><p class="text-small text-muted-ink">{"Git credentials stay separate."}</p></div>
                <div id="account-setup-scroll" class="flex-1 min-h-0 overflow-y-scroll px-4 pb-4" style={|s|s.track_scroll(&self.editor_scroll)}>{fields}</div>
                <div class="p-4 border-t-1 border-line flex flex-col gap-2 shrink-0">
                    if let Some(e)=&self.error{{error(e)}}
                    <div class="flex flex-row justify-between gap-2"><Button variant={ButtonVariant::Secondary} size={ControlSize::Small} state={if self.pending&&!self.waiting{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.cancel(window,cx))))} {..Button::new("account-cancel",if self.pending{"Cancel sign-in"}else{"Cancel"})}/><Button variant={ButtonVariant::Primary} size={ControlSize::Small} state={if self.pending{ControlState::Busy}else if ready{ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.connect(cx))))} {..Button::new("account-connect",if self.pending{"Working…"}else{match self.method{Method::Cli=>"Connect with GitHub CLI",Method::Token=>"Connect",Method::Browser=>"Sign in with browser"}})}/></div>
                </div>
            </div>}
        </div>}.into_any_element();

        let dialog = if let Some(account) = self.removing.clone() {
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(self.remove_epoch);

            let transition = Transition::Tween(Duration::from_millis(160), Easing::EaseOut);

            self.remove_height.animate(
                if self.error.is_some() { 242. } else { 146. },
                transition,
                time,
            );
            self.remove_opacity.animate(1., transition, time);
            let height = self.remove_height.sample(time, cx.reduce_motion());
            let opacity = self.remove_opacity.sample(time, cx.reduce_motion());

            if height.is_animating() || opacity.is_animating() {
                window.request_animation_frame();
            }

            rake::view!{<Dialog kind={DialogKind::Confirmation} width={px(340.)} presentation={DialogPresentation::Compact{height:px(height.value() as f32)}} initial_focus={Some(self.cancel_focus.clone())} availability={if self.pending{DialogAvailability::Busy}else{DialogAvailability::Ready}} {..Dialog::new("account-remove",&self.dialog,"Confirm account removal")}><div class="flex flex-col gap-2.5 p-3 min-w-0" style={|s|s.opacity(opacity.value() as f32)}><p role={gpui::accesskit::Role::Heading} class="text-body font-medium" style={|s|s.aria_level(2)}>{"Remove account?"}</p><p class="text-body">{format!("{} · {} · {}",account.username,account.provider.label(),account.host_label())}</p><p class="text-small text-muted-ink">{if account.credential_source.as_deref()==Some("github-cli"){"Removes this connection from 1git. You stay signed in to GitHub CLI.".into()}else{format!("Removes this account and its saved credentials from 1git. Your {} account and repositories stay unchanged.",account.provider.label())}}</p>
                if let Some(e)=&self.error{{error(e)}}
                <div class="flex flex-row justify-end gap-2"><Button focus={Some(self.cancel_focus.clone())} size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if self.pending{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.dialog.update(cx,|d,cx|d.close(window,cx));this.removing=None;this.error=None;this.load(cx);cx.notify();})))} {..Button::new("account-remove-cancel","Cancel")}/><Button size={ControlSize::Small} variant={ButtonVariant::Secondary} tone={ButtonTone::Danger} state={if self.pending{ControlState::Busy}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.confirm_remove(cx))))} {..Button::new("account-remove-confirm","Remove account")}/></div>
            </div></Dialog>}.into_any_element()
        } else {
            gpui::Empty.into_any_element()
        };

        rake::view! {<div class="flex-1 min-w-0 h-full relative">{body}{dialog}</div>}
    }
}
