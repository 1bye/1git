//! Native component workbench. All actions update sample state; no Git calls are made.
use onegit_ui::{
    Appearance, Button, ButtonTone, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState,
    Dialog, DialogAvailability, DialogDismissal, DialogHost, DialogHostState, DialogKind,
    DialogState, DropdownMenu, Icon, IconButton, IconName, IconSize, InputAvailability, InputEvent,
    InputState, InputValidation, ListRow, MenuAlignment, MenuEntry, MenuItem, Pane, RowSelection,
    SearchField, Text, TextArea, TextInput, TextRole, TextTone, Theme, Toast, ToastAction,
    ToastHost, ToastId, ToastKind, ToastState, Tooltip,
};

use rake::gpui::{self, Context, FocusHandle, Focusable, ScrollHandle, Window, prelude::*, px};

rake::theme!(Theme);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Section {
    #[default]
    Overview,
    Actions,
    Selection,
    Typography,
    Inputs,
    Overlays,
    Dialogs,
    Toasts,
}

#[derive(Clone, Debug)]
enum DialogOperation {
    Create(String),
    Discard,
}

impl DialogOperation {
    fn progress(&self) -> &'static str {
        match self {
            Self::Create(_) => "Creating branch…",
            Self::Discard => "Discarding changes…",
        }
    }
}

struct Gallery {
    appearance: Appearance,
    section: Section,
    focus: FocusHandle,
    scroll: ScrollHandle,
    included: [bool; 3],
    selected: usize,
    activations: usize,
    busy: bool,
    expanded: bool,
    branch: gpui::Entity<InputState>,
    search: gpui::Entity<InputState>,
    message: gpui::Entity<InputState>,
    validation: gpui::Entity<InputState>,
    readonly: gpui::Entity<InputState>,
    disabled_input: gpui::Entity<InputState>,
    submissions: usize,
    current_branch: usize,
    last_file_action: String,
    dialogs: DialogHostState,
    create_dialog: gpui::Entity<DialogState>,
    discard_dialog: gpui::Entity<DialogState>,
    new_branch: gpui::Entity<InputState>,
    discard_cancel: FocusHandle,
    create_attempted: bool,
    slow_dialogs: bool,
    dialog_busy: bool,
    dialog_result: String,
    dialog_task: Option<gpui::Task<()>>,
    toasts: gpui::Entity<ToastState>,
    progress_toast: Option<ToastId>,
    fail_dialogs: bool,
    _input_subscriptions: Vec<gpui::Subscription>,
}

impl Gallery {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Theme::dark().install(cx);
        let focus = cx.focus_handle();

        window.focus(&focus, cx);
        window.activate_window();
        let branch = cx.new(|cx| InputState::new("feature/native-inputs", window, cx));
        let search = cx.new(|cx| InputState::new("", window, cx));

        let message = cx.new(|cx| {
            InputState::new(
                "Refine native inputs\n\nKeep editing state stable while the appearance changes.",
                window,
                cx,
            )
        });

        let validation = cx.new(|cx| InputState::new("feature branch", window, cx));
        let readonly = cx.new(|cx| InputState::new("main", window, cx));
        let disabled_input = cx.new(|cx| InputState::new("Waiting for a repository", window, cx));
        let dialogs = DialogHostState::new(cx);
        let create_dialog = dialogs.dialog(cx);
        let discard_dialog = dialogs.dialog(cx);
        let toasts = cx.new(|cx| ToastState::new(window, cx));
        let new_branch = cx.new(|cx| InputState::new("", window, cx));

        let mut subscriptions: Vec<_> = [&branch, &search, &message, &validation]
            .into_iter()
            .map(|input| {
                cx.subscribe(input, |this, _, event, cx| {
                    if *event == InputEvent::Submitted {
                        this.submissions += 1;
                    }

                    cx.notify();
                })
            })
            .collect();

        subscriptions.push(cx.subscribe_in(
            &new_branch,
            window,
            |this: &mut Self, _, event, window, cx| {
                if *event == InputEvent::Submitted && this.create_dialog.read(cx).is_open() {
                    this.create_branch(window, cx);
                }

                cx.notify();
            },
        ));

        Self {
            dialogs,
            create_dialog,
            discard_dialog,
            new_branch,
            discard_cancel: cx.focus_handle(),
            create_attempted: false,
            slow_dialogs: false,
            dialog_busy: false,
            dialog_result: "No dialog action completed".into(),
            dialog_task: None,
            toasts,
            progress_toast: None,
            fail_dialogs: false,
            branch,
            search,
            message,
            validation,
            readonly,
            disabled_input,
            submissions: 0,
            current_branch: 0,
            last_file_action: "No file action selected".into(),
            _input_subscriptions: subscriptions,
            appearance: Appearance::Dark,
            section: Section::Overview,
            focus,
            scroll: ScrollHandle::new(),
            included: [true, true, false],
            selected: 0,
            activations: 0,
            busy: false,
            expanded: false,
        }
    }

    fn branch_error(&self, cx: &gpui::App) -> Option<&'static str> {
        let name = self.new_branch.read(cx).text();

        if name.is_empty() {
            Some("Enter a branch name.")
        } else if name.chars().any(char::is_whitespace) {
            Some("Use a name without spaces.")
        } else if ["main", "feature/native-ui"].contains(&name) {
            Some("That sample branch already exists.")
        } else {
            None
        }
    }

    fn open_create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.create_attempted = false;
        self.create_dialog.update(cx, |state, cx| {
            state.open(window, cx);
        });
        cx.notify();
    }

    fn create_branch(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.dialog_busy {
            return;
        }

        self.create_attempted = true;

        if self.branch_error(cx).is_some() {
            window.focus(&self.new_branch.read(cx).focus_handle(cx), cx);
            cx.notify();

            return;
        }

        let name = self.new_branch.read(cx).text().to_owned();

        self.start_operation(DialogOperation::Create(name), window, cx);
    }

    fn discard_changes(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.dialog_busy {
            self.start_operation(DialogOperation::Discard, window, cx);
        }
    }

    fn start_operation(
        &mut self,
        operation: DialogOperation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.dialog_busy {
            return;
        }

        self.dialog_busy = true;
        let toast = self.toasts.update(cx, |state, cx| {
            state.show(
                Toast::new(ToastKind::Progress, operation.progress()),
                window,
                cx,
            )
        });

        let fail = self.fail_dialogs;

        if self.slow_dialogs {
            self.dialog_task = Some(cx.spawn_in(window, async move |this, cx| {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(900))
                    .await;
                let _ = this.update_in(cx, |this, window, cx| {
                    this.finish_operation(operation, toast, fail, window, cx)
                });
            }));
        } else {
            self.finish_operation(operation, toast, fail, window, cx);
        }

        cx.notify();
    }

    fn finish_operation(
        &mut self,
        operation: DialogOperation,
        id: ToastId,
        fail: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.dialog_busy = false;
        let (dialog, title, detail) = match &operation {
            DialogOperation::Create(name) => (
                &self.create_dialog,
                if fail {
                    "Couldn’t create branch"
                } else {
                    "Branch created"
                },
                if fail {
                    format!(
                        "The sample operation failed for {name}. Your form values are preserved."
                    )
                } else {
                    format!("Created sample branch: {name}")
                },
            ),
            DialogOperation::Discard => (
                &self.discard_dialog,
                if fail {
                    "Couldn’t discard changes"
                } else {
                    "Changes discarded"
                },
                if fail {
                    "The sample operation failed. File changes remain intact.".into()
                } else {
                    "Discarded changes in 2 sample files".into()
                },
            ),
        };

        dialog.update(cx, |state, cx| {
            state.close(window, cx);
        });
        self.dialog_result = detail.clone();
        let action = if fail {
            let weak = cx.weak_entity();

            Some(ToastAction::new("Retry", move |window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    this.fail_dialogs = false;
                    this.start_operation(operation.clone(), window, cx);
                });
            }))
        } else {
            None
        };

        let toast = Toast {
            description: Some(detail.into()),
            action,
            ..Toast::new(
                if fail {
                    ToastKind::Error
                } else {
                    ToastKind::Success
                },
                title,
            )
        };

        self.toasts.update(cx, |state, cx| {
            let _ = state.update(id, toast, window, cx);
        });
        cx.notify();
    }

    fn toast_examples(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let progress = self.progress_toast.is_some_and(|id| {
            self.toasts
                .read(cx)
                .get(id)
                .is_some_and(|toast| toast.kind == ToastKind::Progress)
        });

        rake::view! {
            <Pane header={Some(rake::view!{<Text role={TextRole::Title} {..Text::new("title","Toasts")}/>}.into_any_element())} {..Pane::new("toasts")}>
                <Text tone={TextTone::Muted} {..Text::new("intro","Compact feedback without taking keyboard focus. Drag a card sideways to dismiss; short pulls snap back.")}/>
                <div class="flex flex-row flex-wrap gap-2">
                    <Button on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.toasts.update(cx,|state,cx|{state.show(Toast {description:Some("Your sample changes are ready.".into()),..Toast::new(ToastKind::Success,"Changes saved")},window,cx);});})))} {..Button::new("success","Show success")}/>
                    <Button on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.toasts.update(cx,|state,cx|{state.show(Toast {description:Some("The sample remote is unavailable. Your changes are safe.".into()),..Toast::new(ToastKind::Error,"Couldn’t fetch")},window,cx);});})))} {..Button::new("error","Show error")}/>
                </div>
                <div class="flex flex-row flex-wrap gap-2">
                    <Button state={if progress{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{
                        this.progress_toast=Some(this.toasts.update(cx,|state,cx|state.show(Toast {description:Some("Waiting for the sample operation to finish.".into()),..Toast::new(ToastKind::Progress,"Fetching branches…")},window,cx)));cx.notify();
                    })))} {..Button::new("start","Start progress")}/>
                    for (index,(kind,label)) in [(ToastKind::Success,"Complete"),(ToastKind::Error,"Fail")].into_iter().enumerate(){
                        <Button id={("resolve",index).into()} state={if progress{ControlState::Enabled}else{ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(move |this,_,window,cx|{if let Some(id)=this.progress_toast.take(){this.toasts.update(cx,|state,cx|{let _=state.update(id,Toast::new(kind,if kind==ToastKind::Success{"Branches fetched"}else{"Couldn’t fetch branches"}),window,cx);});cx.notify();}})))} {..Button::new("resolve",label)}/>
                    }
                    <Button variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.toasts.update(cx,|state,cx|state.clear(window,cx));this.progress_toast=None;cx.notify();})))} {..Button::new("clear","Clear toasts")}/>
                </div>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("help","Success expires after 5 seconds. Errors and progress stay until dismissed or updated. The stack holds up to 3 notifications.")}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("connected","Try the adjacent dialogs: slow operations show progress; simulated failures offer Retry. Hover or focus pauses expiration.")}/>
            </Pane>
        }
    }

    fn dialog_examples(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        rake::view! {
            <Pane header={Some(rake::view!{<Text role={TextRole::Title} {..Text::new("title","Dialogs")}/>}.into_any_element())} {..Pane::new("dialogs")}>
                <Text tone={TextTone::Muted} {..Text::new("intro","Focused forms and clear confirmations. These examples use sample values only.")}/>
                <div class="flex flex-row flex-wrap gap-2">
                    <Button state={if self.dialog_busy{ControlState::Disabled}else{ControlState::Enabled}} icon={Some(IconName::Plus)} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.open_create(window,cx))))} {..Button::new("create","Create branch")}/>
                    <Button state={if self.dialog_busy{ControlState::Disabled}else{ControlState::Enabled}} tone={ButtonTone::Danger} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.discard_dialog.update(cx,|state,cx|{state.open(window,cx);});})))} {..Button::new("discard","Discard changes…")}/>
                </div>
                <Checkbox state={if self.dialog_busy{ControlState::Disabled}else{ControlState::Enabled}} checked={if self.slow_dialogs{CheckState::Checked}else{CheckState::Unchecked}}
                    on_change={Some(Box::new(cx.listener(|this,value:&CheckState,_,cx|{this.slow_dialogs=*value==CheckState::Checked;cx.notify();})))} {..Checkbox::new("slow-dialog","Simulate a slow operation")}/>
                <Checkbox state={if self.dialog_busy{ControlState::Disabled}else{ControlState::Enabled}} checked={if self.fail_dialogs{CheckState::Checked}else{CheckState::Unchecked}}
                    on_change={Some(Box::new(cx.listener(|this,value:&CheckState,_,cx|{this.fail_dialogs=*value==CheckState::Checked;cx.notify();})))} {..Checkbox::new("fail-dialog","Simulate a failed operation")}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("result",self.dialog_result.clone())}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("help","Tab stays inside the dialog. Escape cancels, and closing returns focus to the opener.")}/>
            </Pane>
        }
    }

    fn create_modal(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let busy = self.dialog_busy;
        let error = self.branch_error(cx);

        let footer=rake::view! {
            <div class="flex flex-row flex-wrap items-center gap-2">
                <Button state={if busy{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.create_dialog.update(cx,|state,cx|{state.close(window,cx);});})))} {..Button::new("cancel","Cancel")}/>
                <Button variant={ButtonVariant::Primary} state={if busy{ControlState::Busy}else if self.new_branch.read(cx).text().is_empty(){ControlState::Disabled}else{ControlState::Enabled}}
                    on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.create_branch(window,cx))))} {..Button::new("create",if busy{"Creating…"}else{"Create branch"})}/>
            </div>
        }.into_any_element();

        rake::view! {
            <Dialog description={Some("Create a branch from the current commit on main.".into())} footer={Some(footer)}
                dismissal={DialogDismissal::EscapeAndOutside} availability={if busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
                initial_focus={Some(self.new_branch.read(cx).focus_handle(cx))} {..Dialog::new("create-modal",&self.create_dialog,"Create branch")}>
                <TextInput placeholder={"feature/my-change".into()} description={Some("Use a unique name without spaces.".into())}
                    validation={if self.create_attempted {error.map_or(InputValidation::Valid,|message|InputValidation::Invalid(message.into()))}else{InputValidation::Valid}}
                    availability={if busy{InputAvailability::ReadOnly}else{InputAvailability::Enabled}}
                    {..TextInput::new("branch-name",&self.new_branch,"Branch name")}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("base","Starting point: main · a1b2c3d")}/>
            </Dialog>
        }
    }

    fn discard_modal(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let busy = self.dialog_busy;

        let footer=rake::view! {
            <div class="flex flex-row flex-wrap items-center gap-2">
                <Button focus={Some(self.discard_cancel.clone())} state={if busy{ControlState::Disabled}else{ControlState::Enabled}}
                    on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.discard_dialog.update(cx,|state,cx|{state.close(window,cx);});})))} {..Button::new("cancel","Keep changes")}/>
                <Button variant={ButtonVariant::Primary} tone={ButtonTone::Danger} state={if busy{ControlState::Busy}else{ControlState::Enabled}}
                    on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.discard_changes(window,cx))))} {..Button::new("discard",if busy{"Discarding…"}else{"Discard changes"})}/>
            </div>
        }.into_any_element();

        rake::view! {
            <Dialog kind={DialogKind::Confirmation} description={Some("Discard uncommitted changes in these 2 files?".into())} footer={Some(footer)}
                initial_focus={Some(self.discard_cancel.clone())} availability={if busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
                {..Dialog::new("discard-modal",&self.discard_dialog,"Discard changes?")}>
                <div class="flex flex-col gap-2 rounded-control bg-surface-sunken p-3">
                    for (index,(name,summary)) in [("theme.rs","+24 −8"),("button.rs","+12 −3")].into_iter().enumerate(){
                        <div id={("file",index)} class="flex flex-row items-center gap-2">
                            <Icon {..Icon::new("icon",IconName::File)}/><Text {..Text::new("name",name)}/>
                            <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("summary",summary)}/>
                        </div>
                    }
                </div>
                <Text tone={TextTone::Danger} {..Text::new("warning","Discarded edits cannot be recovered by 1git.")}/>
            </Dialog>
        }
    }

    fn menus(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        const BRANCHES: [&str; 4] = [
            "main",
            "feature/native-ui",
            "fix/selection",
            "release/locked",
        ];
        let branches = BRANCHES
            .into_iter()
            .enumerate()
            .map(|(index, name)| {
                MenuItem {
                    icon: Some(IconName::Branch),
                    selected: Some(self.current_branch == index),
                    disabled: index == 3,
                    ..MenuItem::new(("branch", index), name)
                }
                .into()
            })
            .collect();

        let files = vec![
            MenuItem {
                icon: Some(IconName::Plus),
                ..MenuItem::new("stage", "Stage file")
            }
            .into(),
            MenuItem {
                icon: Some(IconName::File),
                ..MenuItem::new("copy", "Copy relative path")
            }
            .into(),
            MenuEntry::Separator,
            MenuItem {
                disabled: true,
                ..MenuItem::new("unstage", "Unstage file")
            }
            .into(),
            MenuItem {
                tone: ButtonTone::Danger,
                icon: Some(IconName::Close),
                ..MenuItem::new("discard", "Discard changes…")
            }
            .into(),
        ];

        rake::view! {
            <Pane header={Some(rake::view!{<Text role={TextRole::Title} {..Text::new("title","Dropdown menus")}/>}.into_any_element())} {..Pane::new("menus")}>
                <Text tone={TextTone::Muted} {..Text::new("intro","Compact actions with keyboard navigation and clear selection.")}/>
                <div class="flex flex-row items-center gap-2">
                    <DropdownMenu icon={Some(IconName::Branch)} entries={branches}
                        on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{
                            for index in 0..BRANCHES.len() {if *id==gpui::ElementId::from(("branch",index)) {this.current_branch=index;}}
                            cx.notify();
                        })))} {..DropdownMenu::new("branches",BRANCHES[self.current_branch])}/>
                </div>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("branch-state",format!("Selected branch: {}",BRANCHES[self.current_branch]))}/>
                <hr class="bg-line"/>
                <div class="flex flex-row items-center justify-between gap-3">
                    <Text role={TextRole::Code} {..Text::new("file","crates/onegit-ui/src/theme.rs")}/>
                    <DropdownMenu icon={Some(IconName::File)} entries={files} alignment={MenuAlignment::End}
                        on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{
                            this.last_file_action=if *id==gpui::ElementId::from("stage") {"Stage requested"} else if *id==gpui::ElementId::from("copy") {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string("crates/onegit-ui/src/theme.rs".into())); "Relative path copied"
                            }else{"Discard requested (sample only)"}.into();cx.notify();
                        })))} {..DropdownMenu::new("file-actions","File actions")}/>
                </div>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("file-state",self.last_file_action.clone())}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("help","↑ / ↓ navigate · Home / End jump · type to find · Enter selects · Escape closes. Actions use sample state.")}/>
            </Pane>
        }
    }

    fn tooltips(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        rake::view! {
            <Pane header={Some(rake::view!{<Text role={TextRole::Title} {..Text::new("title","Tooltips")}/>}.into_any_element())} {..Pane::new("tooltips")}>
                <Text tone={TextTone::Muted} {..Text::new("intro","Hover briefly or Tab to a control. Escape dismisses the hint.")}/>
                <div class="flex flex-row items-center gap-3">
                    <Tooltip {..Tooltip::new("refresh-hint","Refresh the sample repository") }>
                        <IconButton on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))} {..IconButton::new("refresh",IconName::Refresh,"Refresh sample repository")}/>
                    </Tooltip>
                    <Tooltip {..Tooltip::new("branch-hint","Create a branch from the current commit") }>
                        <Button icon={Some(IconName::Plus)} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))} {..Button::new("new-branch","New branch")}/>
                    </Tooltip>
                </div>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("hint-actions",format!("{} sample action activations",self.activations))}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("help","Hints keep the control’s accessible name, add context, and never take keyboard focus.")}/>
            </Pane>
        }
    }

    fn set_appearance(&mut self, appearance: Appearance, cx: &mut Context<Self>) {
        self.appearance = appearance;
        Theme::for_appearance(appearance).install(cx);
        cx.notify();
    }

    fn actions(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        rake::view! {
            <Pane header={Some(rake::view! { <Text role={TextRole::Title} {..Text::new("title","Actions")}/> }.into_any_element())}
                {..Pane::new("actions")}>
                <Text tone={TextTone::Muted} {..Text::new("intro","A clear hierarchy, with meaning kept separate from emphasis.")}/>
                for (index,(variant,title)) in [
                    (ButtonVariant::Primary,"Primary"),
                    (ButtonVariant::Secondary,"Secondary"),
                    (ButtonVariant::Ghost,"Ghost"),
                ].into_iter().enumerate() {
                    <div id={("variant",index)} class="flex flex-row items-center justify-between gap-3">
                        <Text tone={TextTone::Muted} {..Text::new("label",title)}/>
                        <div class="flex flex-row items-center gap-2">
                            <Button variant={variant}
                                on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))}
                                {..Button::new("normal","Continue")}/>
                            <Button variant={variant} tone={ButtonTone::Danger}
                                on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))}
                                {..Button::new("danger","Delete")}/>
                        </div>
                    </div>
                }
                <hr class="bg-line"/>
                <div class="flex flex-row flex-wrap items-center gap-2">
                    <Button size={ControlSize::Small} {..Button::new("small","Small · 24")}/>
                    <Button {..Button::new("medium","Medium · 28")}/>
                    <Button size={ControlSize::Large} {..Button::new("large","Large · 34")}/>
                </div>
                <div class="flex flex-row flex-wrap items-center gap-2">
                    <Button icon={Some(IconName::Plus)} {..Button::new("leading","New branch")}/>
                    <IconButton on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))}
                        {..IconButton::new("refresh",IconName::Refresh,"Refresh sample")}/>
                    <IconButton tone={ButtonTone::Danger} {..IconButton::new("close",IconName::Close,"Close sample")}/>
                </div>
                <div class="flex flex-row items-center gap-3">
                    <Button variant={ButtonVariant::Primary}
                        size={if self.expanded {ControlSize::Large} else {ControlSize::Small}}
                        icon={if self.expanded {Some(IconName::Check)} else {None}}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.expanded= !this.expanded;cx.notify();})))}
                        {..Button::new("resize",if self.expanded {"Commit selected changes"} else {"Commit"})}/>
                    <Text tone={TextTone::Muted} {..Text::new("resize-hint","Click to resize")}/>
                </div>
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("count",format!("{} action activations",self.activations))}/>
            </Pane>
        }
    }

    fn states(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        rake::view! {
            <Pane header={Some(rake::view! { <Text role={TextRole::Title} {..Text::new("title","Interaction states")}/> }.into_any_element())}
                {..Pane::new("states")}>
                <Text tone={TextTone::Muted} {..Text::new("intro","Tab to a control. Enter and Space activate it once.")}/>
                <div class="flex flex-row flex-wrap gap-2 items-center">
                    <Button variant={ButtonVariant::Primary} state={ControlState::Disabled}
                        {..Button::new("disabled","Unavailable")}/>
                    <Button variant={ButtonVariant::Primary} state={ControlState::Busy}
                        {..Button::new("busy","Fetching")}/>
                    <Button variant={ButtonVariant::Primary}
                        state={if self.busy {ControlState::Busy} else {ControlState::Enabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))}
                        {..Button::new("work","Preview action")}/>
                </div>
                <Checkbox checked={if self.busy {CheckState::Checked} else {CheckState::Unchecked}}
                    on_change={Some(Box::new(cx.listener(|this,value:&CheckState,_,cx|{
                        this.busy= *value==CheckState::Checked;cx.notify();
                    })))} {..Checkbox::new("simulate","Show busy state")}/>
                <Checkbox checked={if cx.reduce_motion() {CheckState::Checked} else {CheckState::Unchecked}}
                    on_change={Some(Box::new(cx.listener(|_,value:&CheckState,_,cx|{
                        cx.set_reduce_motion(*value==CheckState::Checked);cx.notify();
                    })))} {..Checkbox::new("reduce-motion","Reduce motion")}/>
                <Checkbox state={ControlState::Disabled} checked={CheckState::Checked}
                    {..Checkbox::new("disabled-check","Disabled selection")}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("help","Busy and disabled actions skip Tab. Keyboard focus remains distinct from persistent selection.")}/>
            </Pane>
        }
    }

    fn selection(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let included = self.included.iter().filter(|v| **v).count();

        let all = match included {
            0 => CheckState::Unchecked,
            3 => CheckState::Checked,
            _ => CheckState::Mixed,
        };

        let footer=rake::view! {
            <div class="flex flex-row items-center justify-between gap-2">
                <Text tone={TextTone::Muted} {..Text::new("included",format!("{included} of 3 included"))}/>
                <Button variant={ButtonVariant::Primary}
                    state={if included==0 {ControlState::Disabled} else {ControlState::Enabled}}
                    on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))}
                    {..Button::new("commit","Preview commit")}/>
            </div>
        }.into_any_element();

        rake::view! {
            <Pane header={Some(rake::view! {
                <div class="flex flex-row items-center justify-between">
                    <Text role={TextRole::Title} {..Text::new("title","Changes")}/>
                    <Checkbox checked={all} on_change={Some(Box::new(cx.listener(|this,value:&CheckState,_,cx|{
                        this.included.fill(*value==CheckState::Checked);cx.notify();
                    })))} {..Checkbox::new("all","Include all")}/>
                </div>
            }.into_any_element())} footer={Some(footer)} {..Pane::new("selection")}>
                for (index,(name,path)) in [
                    ("theme.rs","crates/onegit-ui/src"),
                    ("button.rs","crates/onegit-ui/src"),
                    ("A deliberately long file name — 日本語 · café.rs","packages/shared/components"),
                ].into_iter().enumerate() {
                    <ListRow id={("file",index).into()} description={Some(path.into())}
                        selection={if self.selected==index {RowSelection::Selected} else {RowSelection::Unselected}}
                        leading={Some(rake::view! {
                            <Icon {..Icon::new("file-icon",IconName::File)}/>
                        }.into_any_element())}
                        trailing={Some(rake::view! {
                            <div class="flex flex-row items-center gap-1">
                                <IconButton size={ControlSize::Small}
                                    on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.activations+=1;cx.notify();})))}
                                    {..IconButton::new("refresh",IconName::Refresh,format!("Refresh {name}"))}/>
                                <Checkbox show_label={false} checked={if self.included[index] {CheckState::Checked} else {CheckState::Unchecked}}
                                    on_change={Some(Box::new(cx.listener(move |this,value:&CheckState,_,cx|{
                                        this.included[index]= *value==CheckState::Checked;cx.notify();
                                    })))} {..Checkbox::new("include",format!("Include {name}"))}/>
                            </div>
                        }.into_any_element())}
                        on_press={Some(Box::new(cx.listener(move |this,_,_,cx|{this.selected=index;cx.notify();})))}
                        {..ListRow::new("file",name)}/>
                }
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("caption","Hover anywhere on a row; actions and checkboxes keep independent activation.")}/>
            </Pane>
        }
    }

    fn inputs(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.search.read(cx).text().to_lowercase();
        let names = ["theme.rs", "button.rs", "日本語 · café.rs"];

        let matched: Vec<_> = names
            .into_iter()
            .filter(|name| name.to_lowercase().contains(&query))
            .collect();

        let characters = unicode_segmentation::UnicodeSegmentation::graphemes(
            self.message.read(cx).text(),
            true,
        )
        .count();

        rake::view! {
            <Pane header={Some(rake::view! {<Text role={TextRole::Title} {..Text::new("title","Text & search")}/>}.into_any_element())}
                {..Pane::new("inputs")}>
                <TextInput placeholder={"feature/native-inputs".into()} description={Some("Native selection, clipboard, undo and composition.".into())}
                    {..TextInput::new("branch",&self.branch,"Branch name")}/>
                <SearchField placeholder={"Filter sample files…".into()} {..SearchField::new("search",&self.search,"Search files")}/>
                <div class="flex flex-col gap-1">
                    for (index,name) in matched.iter().enumerate() {
                        <Text id={("result",index).into()} {..Text::new("result",*name)}/>
                    }
                    if matched.is_empty() {<Text tone={TextTone::Muted} {..Text::new("empty","No matching files")}/>}
                </div>
                <TextArea rows={5} placeholder={"Describe the change and why it helps…".into()}
                    {..TextArea::new("message",&self.message,"Commit message")}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("input-status",format!("{characters} characters · {} submissions",self.submissions))}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("input-help",if cfg!(target_os="macos") {"Enter submits a single-line field. ⌘Enter submits a message; Enter adds a line."} else {"Enter submits a single-line field. Ctrl+Enter submits a message; Enter adds a line."})}/>
            </Pane>
        }
    }

    fn input_states(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let invalid = self.validation.read(cx).text().contains(' ');

        rake::view! {
            <Pane header={Some(rake::view! {<Text role={TextRole::Title} {..Text::new("title","Input states")}/>}.into_any_element())}
                {..Pane::new("input-states")}>
                <TextInput validation={if invalid {InputValidation::Invalid("Use a branch name without spaces.".into())}else{InputValidation::Valid}}
                    description={Some("Fix the space to clear this example error.".into())}
                    {..TextInput::new("validation",&self.validation,"Branch validation")}/>
                <TextInput size={ControlSize::Small} availability={InputAvailability::ReadOnly}
                    description={Some("Read-only text remains selectable and copyable.".into())}
                    {..TextInput::new("readonly",&self.readonly,"Default branch")}/>
                <TextInput availability={InputAvailability::Disabled}
                    {..TextInput::new("disabled-input",&self.disabled_input,"Repository remote")}/>
                <Button on_press={Some(Box::new(cx.listener(|this,_,_,cx| {
                    this.branch.update(cx,|state,cx|state.set_text("feature/native-inputs",cx));
                    this.search.update(cx,|state,cx|state.set_text("",cx));
                    this.message.update(cx,|state,cx|state.set_text("Refine native inputs\n\nKeep editing state stable while the appearance changes.",cx));
                    this.validation.update(cx,|state,cx|state.set_text("feature branch",cx));
                    this.submissions=0;cx.notify();
                })))} {..Button::new("reset-inputs","Reset input examples")}/>
            </Pane>
        }
    }

    fn typography(&mut self) -> impl IntoElement {
        rake::view! {
            <Pane header={Some(rake::view! { <Text role={TextRole::Title} {..Text::new("title","Type & symbols")}/> }.into_any_element())}
                {..Pane::new("typography")}>
                <Text role={TextRole::Heading} {..Text::new("heading","A quieter place to work.")}/>
                <Text {..Text::new("body","Body text stays compact, with enough leading for readable native controls.")}/>
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("caption","Metadata · 10/14 px · Yesterday at 14:32")}/>
                <Text role={TextRole::Code} {..Text::new("code","let selection = CheckState::Mixed;")}/>
                <div class="flex flex-row flex-wrap gap-4">
                    <Text tone={TextTone::Success} {..Text::new("success","Added +24")}/>
                    <Text tone={TextTone::Danger} {..Text::new("danger","Deleted −8")}/>
                    <Text tone={TextTone::Warning} {..Text::new("warning","Needs review")}/>
                </div>
                <div class="flex flex-row flex-wrap items-center gap-4">
                    for (index,name) in [IconName::Branch,IconName::File,IconName::Folder,IconName::Refresh,IconName::Plus,IconName::Check,IconName::Working,IconName::Alert,IconName::Search,IconName::Minus,IconName::Close,IconName::ChevronDown,IconName::Sun].into_iter().enumerate() {
                        <span id={("icon",index)}>
                            <Icon size={IconSize::Large} label={Some(format!("{name:?}").into())} {..Icon::new("glyph",name)}/>
                        </span>
                    }
                </div>
            </Pane>
        }
    }
}

impl Render for Gallery {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let columns = if window.viewport_size().width < px(850.) {
            1
        } else {
            2
        };

        let item_count: u16 = match self.section {
            Section::Overview => 10,
            Section::Actions | Section::Inputs | Section::Overlays | Section::Toasts => 2,
            Section::Selection | Section::Typography | Section::Dialogs => 1,
        };

        let rows = item_count.div_ceil(columns);

        let body = rake::view! {
            <main class="size-full flex flex-col bg-background text-ink" focus={&self.focus} tab-navigation={true}>
                <header class="flex flex-row items-center justify-between gap-4 px-6 py-4 border-b-1 border-line">
                    <div class="flex flex-col gap-1">
                        <Text role={TextRole::Heading} {..Text::new("brand","1git / UI")}/>
                        <Text tone={TextTone::Muted} {..Text::new("subtitle","Native controls. One shared language.")}/>
                    </div>
                    <div class="flex flex-row items-center gap-1">
                        <Button variant={if self.appearance==Appearance::Light {ButtonVariant::Secondary} else {ButtonVariant::Ghost}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.set_appearance(Appearance::Light,cx))))}
                            {..Button::new("light","Light")}/>
                        <Button variant={if self.appearance==Appearance::Dark {ButtonVariant::Secondary} else {ButtonVariant::Ghost}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.set_appearance(Appearance::Dark,cx))))}
                            {..Button::new("dark","Dark")}/>
                    </div>
                </header>
                <nav class="flex flex-row flex-wrap gap-1 px-6 py-3">
                    for (index,(section,label)) in [(Section::Overview,"Overview"),(Section::Actions,"Actions"),(Section::Selection,"Selection"),(Section::Typography,"Typography"),(Section::Inputs,"Inputs"),(Section::Overlays,"Menus & hints"),(Section::Dialogs,"Dialogs"),(Section::Toasts,"Toasts")].into_iter().enumerate() {
                        <Button id={("section",index).into()}
                            variant={if self.section==section {ButtonVariant::Secondary} else {ButtonVariant::Ghost}}
                            on_press={Some(Box::new(cx.listener(move |this,_,_,cx|{
                                this.section=section;this.scroll.set_offset(gpui::point(px(0.),px(0.)));cx.notify();
                            })))} {..Button::new("section",label)}/>
                    }
                </nav>
                <div class="flex-1 min-h-0 overflow-y-scroll px-6 pb-6" scroll={&self.scroll}>
                    <div class="grid gap-4 shrink-0" style={|s|s.grid_cols(columns).grid_rows_max_content(rows)}>
                        if matches!(self.section,Section::Overview|Section::Actions) { {self.actions(cx)} {self.states(cx)} }
                        if matches!(self.section,Section::Overview|Section::Selection) { {self.selection(cx)} }
                        if matches!(self.section,Section::Overview|Section::Typography) { {self.typography()} }
                        if matches!(self.section,Section::Overview|Section::Inputs) { {self.inputs(cx)} {self.input_states(cx)} }
                        if matches!(self.section,Section::Overview|Section::Overlays) { {self.menus(cx)} {self.tooltips(cx)} }
                        if matches!(self.section,Section::Overview|Section::Dialogs|Section::Toasts) {{self.dialog_examples(cx)}}
                        if matches!(self.section,Section::Overview|Section::Toasts) {{self.toast_examples(cx)}}
                    </div>
                </div>
                <footer class="px-6 py-2 border-t-1 border-line">
                    <Text role={TextRole::Caption} tone={TextTone::Muted}
                        {..Text::new("footer","1git components · 24 / 28 / 34 px controls · keyboard focus always visible")}/>
                </footer>
            </main>
        }.into_any_element();

        rake::view! {
            <DialogHost state={self.dialogs.clone()} body={body}>
                {self.create_modal(cx)}
                {self.discard_modal(cx)}
                <ToastHost paused={self.dialogs.is_open(cx)} {..ToastHost::new("notifications",&self.toasts,&self.focus)}/>
            </DialogHost>
        }
    }
}

fn main() -> Result<(), rake::AppError> {
    rake::App::new("dev.1git.ui-gallery")
        .control(rake::control::ControlConfig::FromEnvironment)
        .window_options(gpui::WindowOptions {
            window_bounds: Some(gpui::WindowBounds::Windowed(gpui::Bounds {
                origin: gpui::point(px(100.), px(80.)),
                size: gpui::size(px(1080.), px(900.)),
            })),
            window_min_size: Some(gpui::size(px(620.), px(520.))),
            titlebar: Some(gpui::TitlebarOptions {
                title: Some("1git — Component gallery".into()),
                ..Default::default()
            }),
            ..Default::default()
        })
        .root(|_, window, cx| cx.new(|cx| Gallery::new(window, cx)).into())
        .run()
}
