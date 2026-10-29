//! Native component workbench. All actions update sample state; no Git calls are made.
use onegit_ui::{
    Appearance, Button, ButtonTone, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState,
    Icon, IconButton, IconName, IconSize, ListRow, Pane, RowSelection, Text, TextRole, TextTone,
    Theme,
};
use rake::gpui::{self, Context, FocusHandle, ScrollHandle, Window, prelude::*, px};

rake::theme!(Theme);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Section {
    #[default]
    Overview,
    Actions,
    Selection,
    Typography,
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
}

impl Gallery {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Theme::dark().install(cx);
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        Self {
            appearance: Appearance::Dark,
            section: Section::Overview,
            focus,
            scroll: ScrollHandle::new(),
            included: [true, true, false],
            selected: 0,
            activations: 0,
            busy: false,
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
                            <Checkbox show_label={false} checked={if self.included[index] {CheckState::Checked} else {CheckState::Unchecked}}
                                on_change={Some(Box::new(cx.listener(move |this,value:&CheckState,_,cx|{
                                    this.included[index]= *value==CheckState::Checked;cx.notify();
                                })))} {..Checkbox::new("include",format!("Include {name}"))}/>
                        }.into_any_element())}
                        on_press={Some(Box::new(cx.listener(move |this,_,_,cx|{this.selected=index;cx.notify();})))}
                        {..ListRow::new("file",name)}/>
                }
                <Text role={TextRole::Caption} tone={TextTone::Muted}
                    {..Text::new("caption","Sample data · row selection and checkbox inclusion are independent")}/>
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
                    for (index,name) in [IconName::Branch,IconName::File,IconName::Folder,IconName::Refresh,IconName::Plus,IconName::Check,IconName::Working,IconName::Minus,IconName::Close,IconName::ChevronDown,IconName::Sun].into_iter().enumerate() {
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
        rake::view! {
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
                    for (index,(section,label)) in [(Section::Overview,"Overview"),(Section::Actions,"Actions"),(Section::Selection,"Selection"),(Section::Typography,"Typography")].into_iter().enumerate() {
                        <Button id={("section",index).into()}
                            variant={if self.section==section {ButtonVariant::Secondary} else {ButtonVariant::Ghost}}
                            on_press={Some(Box::new(cx.listener(move |this,_,_,cx|{
                                this.section=section;this.scroll.set_offset(gpui::point(px(0.),px(0.)));cx.notify();
                            })))} {..Button::new("section",label)}/>
                    }
                </nav>
                <div class="flex-1 min-h-0 overflow-y-scroll px-6 pb-6" scroll={&self.scroll}>
                    <div class="grid gap-4" style={|s|s.grid_cols(columns)}>
                        if matches!(self.section,Section::Overview|Section::Actions) { {self.actions(cx)} {self.states(cx)} }
                        if matches!(self.section,Section::Overview|Section::Selection) { {self.selection(cx)} }
                        if matches!(self.section,Section::Overview|Section::Typography) { {self.typography()} }
                    </div>
                </div>
                <footer class="px-6 py-2 border-t-1 border-line">
                    <Text role={TextRole::Caption} tone={TextTone::Muted}
                        {..Text::new("footer","1git components · 24 / 28 / 34 px controls · keyboard focus always visible")}/>
                </footer>
            </main>
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
