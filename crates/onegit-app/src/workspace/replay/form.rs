//! Compact confirmation with retained branch search and fast, idle-free CE motion.
use super::{Action, Kind, Open, Review, Submit, unavailable};
use crate::workspace::{ReadJob, read::Loaded};
use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::{Branch, BranchKind, Cancellation, ResetCommitPlan};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability, DialogDismissal,
    DialogHostState, DialogPresentation, DialogState, InputAvailability, InputEvent, InputState,
    TextInput,
};

use rake::gpui::{self, AppContext, Focusable, prelude::*, px};

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub(in crate::workspace) struct Form {
    dialog: gpui::Entity<DialogState>,
    rewrite: gpui::Entity<super::rewrite::Form>,
    tags: gpui::Entity<super::tags::Form>,
    pub(super) query: gpui::Entity<InputState>,
    review: Option<Review>,
    kind: Kind,
    branches: Arc<[Branch]>,
    pub(super) selected: Option<(String, String)>,
    read_job: Option<ReadJob>,
    deadline: Option<gpui::Task<()>>,
    reset_plan: Option<ResetCommitPlan>,
    scroll: gpui::UniformListScrollHandle,
    list_focus: gpui::FocusHandle,
    cancel_focus: gpui::FocusHandle,
    source: Option<Arc<Loaded>>,
    blocked: bool,
    pub(in crate::workspace) busy: bool,
    uncertain: bool,
    error: Option<String>,
    epoch: Instant,
    opacity: MotionValue,
    height: MotionValue,
    _events: Vec<gpui::Subscription>,
}

impl Form {
    pub fn new(
        host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let query = cx.new(|cx| InputState::new("", window, cx));

        let tags = cx.new(|cx| super::tags::Form::new(host, window, cx));
        let rewrite = cx.new(|cx| super::rewrite::Form::new(host, window, cx));

        let mut events =
            vec![
                cx.subscribe_in(&query, window, |this, _, event: &InputEvent, window, cx| {
                    if *event == InputEvent::Changed && !this.busy {
                        this.selected = None;
                        this.scroll.scroll_to_item(0, gpui::ScrollStrategy::Top);
                    } else if *event == InputEvent::Submitted {
                        this.submit(cx);
                    } else if matches!(event, InputEvent::Changed) {
                        return;
                    }
                    if *event == InputEvent::Submitted {
                        window.prevent_default();
                    }
                    cx.notify();
                }),
            ];

        events.push(cx.subscribe(&rewrite, |this, _, event: &Submit, cx| {
            this.busy = true;
            cx.emit(event.clone());
            cx.notify();
        }));

        events.push(cx.subscribe(&tags, |this, _, event: &Submit, cx| {
            this.busy = true;
            cx.emit(event.clone());
            cx.notify();
        }));

        Self {
            tags,
            rewrite,
            dialog: host.dialog(cx),
            query,
            review: None,
            kind: Kind::Revert,
            branches: Arc::from([]),
            selected: None,
            read_job: None,
            deadline: None,
            reset_plan: None,
            scroll: gpui::UniformListScrollHandle::new(),
            list_focus: cx.focus_handle(),
            cancel_focus: cx.focus_handle(),
            source: None,
            blocked: true,
            busy: false,
            uncertain: false,
            error: None,
            epoch: cx.background_executor().now(),
            opacity: MotionValue::new(0.),
            height: MotionValue::new(174.),
            _events: events,
        }
    }

    pub fn configure(
        &mut self,
        source: Option<Arc<Loaded>>,
        blocked: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        self.tags
            .update(cx, |form, cx| form.configure(source.clone(), blocked, cx));
        self.rewrite
            .update(cx, |form, cx| form.configure(source.clone(), blocked, cx));
        let changed = self.blocked != blocked
            || self.source.as_ref().map(|s| {
                (
                    onegit_git::BranchIdentity::from_snapshot(&s.snapshot),
                    s.snapshot.operation,
                    s.snapshot.status.files.len(),
                )
            }) != source.as_ref().map(|s| {
                (
                    onegit_git::BranchIdentity::from_snapshot(&s.snapshot),
                    s.snapshot.operation,
                    s.snapshot.status.files.len(),
                )
            });

        self.source = source;
        self.blocked = blocked;

        if changed {
            cx.notify();
        }
    }

    pub fn open_tag(
        &mut self,
        source: Arc<Loaded>,
        event: &super::tags::Open,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.kind = if event.tag.is_some() {
            Kind::DeleteTag
        } else {
            Kind::CreateTag
        };
        self.tags
            .update(cx, |form, cx| form.open(source, event, window, cx));
        cx.notify();
    }

    pub fn open(
        &mut self,
        source: Arc<Loaded>,
        event: &Open,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        let Some(commit) = event.commits.first().cloned() else {
            return;
        };

        self.kind = event.kind;

        if event.kind.is_rewrite() {
            self.rewrite
                .update(cx, |form, cx| form.open(source, event, window, cx));

            return;
        }

        self.read_job = None;
        self.deadline = None;
        self.reset_plan = None;
        self.review = Some(Review::new(&source, commit));
        self.source = Some(source.clone());
        self.selected = None;
        self.branches = Arc::from([]);
        self.error = None;
        self.uncertain = false;
        self.query.update(cx, |input, cx| input.set_text("", cx));
        self.scroll.scroll_to_item(0, gpui::ScrollStrategy::Top);
        self.epoch = cx.background_executor().now();
        self.opacity = MotionValue::new(0.);
        self.height = MotionValue::new(match self.kind {
            Kind::CherryPick => 410.,
            Kind::Revert => 174.,
            Kind::Reset => 214.,
            Kind::Squash | Kind::Reorder | Kind::CreateTag | Kind::DeleteTag => {
                unreachable!("range actions use their own form")
            }
        });
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));

        if self.kind == Kind::CherryPick {
            let cancel = Cancellation::default();
            let worker_cancel = cancel.clone();
            let completion_cancel = cancel.clone();

            let source = source.clone();

            let worker = cx.background_executor().spawn(async move {
                source
                    .repository
                    .branches(Some(&worker_cancel))
                    .map_err(crate::workspace::read::message)
            });

            let task = cx.spawn(async move |this, cx| {
                let branches = worker.await;

                if !completion_cancel.is_cancelled() {
                    let _ = this.update(cx, |this, cx| {
                        this.read_job = None;

                        match branches {
                            Ok(branches) => {
                                this.branches = branches
                                    .branches
                                    .into_iter()
                                    .filter(|branch| {
                                        branch.kind == BranchKind::Local
                                            && !branch.checked_out
                                            && branch.worktree_path.is_none()
                                            && this
                                                .review
                                                .as_ref()
                                                .and_then(|r| r.expected.branch.as_ref())
                                                != Some(&branch.name)
                                    })
                                    .collect()
                            }
                            Err(error) => this.error = Some(error),
                        }

                        cx.notify();
                    });
                }
            });

            self.read_job = Some(ReadJob {
                cancel,
                task: Some(task),
            });
        }

        if self.kind == Kind::Reset {
            let request = self
                .review
                .as_ref()
                .expect("captured reset review")
                .reset_request();

            let cancel = Cancellation::default();
            let worker_cancel = cancel.clone();
            let completion_cancel = cancel.clone();

            let worker = cx.background_executor().spawn(async move {
                source
                    .repository
                    .reset_commit_plan(&request, Some(&worker_cancel))
                    .map_err(crate::workspace::read::message)
            });

            let task = cx.spawn(async move |this, cx| {
                let result = worker.await;

                if !completion_cancel.is_cancelled() {
                    let _ = this.update(cx, |this, cx| {
                        this.deadline = None;
                        this.read_job = None;

                        match result {
                            Ok(plan) => this.reset_plan = Some(plan),
                            Err(error) => this.error = Some(error),
                        }

                        cx.notify();
                    });
                }
            });

            self.read_job = Some(ReadJob {
                cancel,
                task: Some(task),
            });
            self.deadline = Some(cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(Duration::from_secs(10))
                    .await;
                let _ = this.update(cx, |this, cx| {
                    this.read_job = None;
                    this.error =
                        Some("Could not review the reset. Cancel and refresh History.".into());
                    cx.notify();
                });
            }));
        }

        cx.notify();
    }

    fn reason(&self) -> Option<&str> {
        let review = self.review.as_ref()?;

        if self.kind != Kind::Reset && review.commit.parent_oids.len() > 1 {
            return Some(
                "Merge commits require an external Git tool to choose the mainline parent.",
            );
        }

        let Some(source) = &self.source else {
            return Some("The repository is unavailable. Cancel and reopen the action.");
        };

        if !review.matches(source) {
            return Some("The branch changed. Cancel and review History again.");
        }

        if self.blocked {
            return Some("The repository is busy or needs a refresh.");
        }

        unavailable(source)
    }

    fn visible(&self, cx: &gpui::App) -> Vec<usize> {
        let needle = self.query.read(cx).text().trim().to_lowercase();

        self.branches
            .iter()
            .enumerate()
            .filter_map(|(i, b)| b.name.to_lowercase().contains(&needle).then_some(i))
            .collect()
    }

    fn target(&self, cx: &gpui::App) -> Option<&Branch> {
        self.selected.as_ref().and_then(|(name, oid)| {
            self.visible(cx)
                .into_iter()
                .map(|i| &self.branches[i])
                .find(|branch| branch.name == *name && branch.oid == *oid)
        })
    }

    pub(super) fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy
            || self.uncertain
            || self.error.is_some()
            || self.read_job.is_some()
            || self.reason().is_some()
        {
            return;
        }

        let Some(review) = self.review.clone() else {
            return;
        };

        let action = match self.kind {
            Kind::CherryPick => {
                let Some(target) = self.target(cx) else {
                    return;
                };

                Action::CherryPick {
                    review,
                    destination: (target.name.clone(), target.oid.clone()),
                }
            }
            Kind::Revert => Action::Revert(review),
            Kind::Squash | Kind::Reorder | Kind::CreateTag | Kind::DeleteTag => return,
            Kind::Reset => {
                if self
                    .reset_plan
                    .as_ref()
                    .is_none_or(|plan| plan.target.oid != review.commit.oid)
                {
                    return;
                }

                Action::Reset(review)
            }
        };

        self.busy = true;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Busy, cx)
        });
        cx.emit(Submit(action));
        cx.notify();
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.kind.is_tag() {
            self.busy = false;
            self.tags
                .update(cx, |form, cx| form.finish(result, window, cx));

            return;
        }

        if self.kind.is_rewrite() {
            self.busy = false;
            self.rewrite
                .update(cx, |form, cx| form.finish(result, window, cx));

            return;
        }

        if !self.busy {
            return;
        }

        self.busy = false;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => {
                self.dialog
                    .update(cx, |dialog, cx| dialog.close(window, cx));
            }
            Err(error) => {
                self.reset_plan = None;
                self.error = Some(error);
                self.uncertain = true;
            }
        }

        cx.notify();
    }

    #[cfg(test)]
    pub(in crate::workspace) fn is_open(&self, cx: &gpui::App) -> bool {
        if self.kind.is_tag() {
            self.tags.read(cx).is_open(cx)
        } else if self.kind.is_rewrite() {
            self.rewrite.read(cx).is_open(cx)
        } else {
            self.dialog.read(cx).is_open()
        }
    }

    fn navigate(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.uncertain || event.keystroke.modifiers.modified() {
            return;
        }

        let visible = self.visible(cx);

        if visible.is_empty() {
            return;
        }

        let position = visible.iter().position(|&i| {
            self.selected.as_ref()
                == Some(&(self.branches[i].name.clone(), self.branches[i].oid.clone()))
        });

        let index = match event.keystroke.key.as_str() {
            "down" => position.map_or(0, |p| (p + 1).min(visible.len() - 1)),
            "up" => position.map_or(visible.len() - 1, |p| p.saturating_sub(1)),
            "home" => 0,
            "end" => visible.len() - 1,
            "enter" => {
                self.submit(cx);

                return;
            }
            _ => return,
        };

        let branch = &self.branches[visible[index]];

        self.selected = Some((branch.name.clone(), branch.oid.clone()));
        self.scroll
            .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
    }
}

impl Render for Form {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        if self.kind.is_tag() {
            return self.tags.clone().into_any_element();
        }

        if self.kind.is_rewrite() {
            return self.rewrite.clone().into_any_element();
        }

        if !self.dialog.read(cx).is_open() {
            self.read_job = None;
            self.deadline = None;

            return gpui::Empty.into_any_element();
        }

        let Some(review) = self.review.clone() else {
            return gpui::Empty.into_any_element();
        };

        let error = self
            .error
            .as_deref()
            .or_else(|| if self.busy { None } else { self.reason() })
            .map(str::to_owned);

        let cherry = self.kind == Kind::CherryPick;
        let reset = self.kind == Kind::Reset;

        let blocked = self.busy
            || self.uncertain
            || error.is_some()
            || self.read_job.is_some()
            || (cherry && self.target(cx).is_none())
            || (reset && self.reset_plan.is_none());

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        self.opacity.animate(
            1.,
            Transition::Tween(Duration::from_millis(120), Easing::EaseOut),
            time,
        );
        self.height.animate(
            match self.kind {
                Kind::CherryPick => 410.,
                Kind::Revert => 174.,
                Kind::Reset => 214.,
                Kind::Squash | Kind::Reorder | Kind::CreateTag | Kind::DeleteTag => {
                    unreachable!("range actions use their own form")
                }
            } + if error.is_some() { 64. } else { 0. },
            Transition::Tween(Duration::from_millis(120), Easing::EaseOut),
            time,
        );
        let opacity = self.opacity.sample(time, cx.reduce_motion());
        let height = self.height.sample(time, cx.reduce_motion());

        if opacity.is_animating() || height.is_animating() {
            window.request_animation_frame();
        }

        let visible = self.visible(cx);
        let branches = self.branches.clone();
        let selection = self.selected.clone();
        let owner = cx.entity().downgrade();
        let unavailable = self.busy || self.uncertain;
        let focus = self.list_focus.clone();

        let list=gpui::uniform_list("destination-rows",visible.len(),move|range,window,_|range.map(|row|{
            let branch=&branches[visible[row]];
            let name=branch.name.clone();let oid=branch.oid.clone();let owner=owner.clone();let focus=focus.clone();

            let active=selection.as_ref()==Some(&(name.clone(),oid.clone()));
            let owns=focus.is_focused(window);

            rake::view!{
                <div id={row} role={gpui::accesskit::Role::ListBoxOption} aria-label={branch.name.clone()} class="h-[28px] flex flex-col justify-center"
                    style={|s|s.aria_selected(active).when(active&&owns,|s|s.aria_active_descendant())}>
                <onegit_ui::ListRow variant={onegit_ui::ListRowVariant::Compact} tab_index={-1} selection={if active{onegit_ui::RowSelection::Selected}else{onegit_ui::RowSelection::Unselected}}
                    state={if unavailable{ControlState::Disabled}else{ControlState::Enabled}}
                    on_press={Some(Box::new(move|_,window,cx|{window.focus(&focus,cx);let _=owner.update(cx,|this,cx|{this.selected=Some((name.clone(),oid.clone()));cx.notify();});}))}
                    {..onegit_ui::ListRow::new(branch.full_name.clone(),branch.name.clone())}/>
                </div>
            }.into_any_element()
        }).collect()).size_full().track_scroll(&self.scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        let summary = self
            .target(cx)
            .map(|target| {
                format!(
                    "Switch to {} and copy this commit. {} stays unchanged.",
                    target.name,
                    review.expected.branch.as_deref().unwrap_or("Source branch")
                )
            })
            .unwrap_or_else(|| {
                "Choose a local destination branch. Branches open in other worktrees are excluded."
                    .into()
            });

        let label = self.kind.title();

        let focus = Some(if cherry {
            self.query.read(cx).focus_handle(cx)
        } else {
            self.cancel_focus.clone()
        });

        rake::view!{
            <Dialog width={px(420.)} presentation={DialogPresentation::Compact{height:px(height.value()as f32)}} dismissal={DialogDismissal::EscapeAndOutside}
                availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}} initial_focus={focus}
                {..Dialog::new("replay-confirmation",&self.dialog,label)}>
                <div class="size-full min-h-0 flex flex-col gap-3 p-2 overflow-y-scroll" style={|s|s.opacity(opacity.value()as f32)}>
                    <p class="shrink-0 text-title" style={|s|s.font_weight(gpui::FontWeight::NORMAL)}>{if cherry||reset{label}else{"Revert this commit?"}}</p>
                    if reset {
                        <p class="shrink-0 text-small" style={|s|s.line_clamp(2)}>{format!("{} · {}",review.commit.oid.chars().take(7).collect::<String>(),review.commit.summary)}</p>
                        if let Some(plan)=&self.reset_plan {
                            <p class="shrink-0 text-body">{format!("Undo {} later {}. The selected commit stays.",plan.commit_count,if plan.commit_count==1{"commit"}else{"commits"})}</p>
                        } else if error.is_none() {<p class="shrink-0 text-body text-muted-ink">"Reviewing history…"</p>}
                        <p class="shrink-0 text-small text-muted-ink">"Files stay unchanged. The undone changes return to Changes, ready to edit or commit again. Original history is retained for recovery."</p>
                        <p class="shrink-0 text-caption text-muted-ink">"Only unpublished history. Fetch first if another tool may have pushed. Other branches and existing tags stay unchanged."</p>
                    } else {
                    <p class={if cherry{"shrink-0 text-body"}else{"shrink-0 text-small"}} style={|s|s.line_clamp(2)}>{review.commit.summary.clone()}</p>
                    <p class="shrink-0 text-caption text-muted-ink">{format!("{} · {}",review.commit.oid.chars().take(7).collect::<String>(),review.expected.branch.as_deref().unwrap_or(""))}</p>
                    if cherry {
                        <div style={|s|s.on_key_down(cx.listener(|this,event:&gpui::KeyDownEvent,window,cx|{if event.keystroke.key=="down"{window.focus(&this.list_focus,cx);this.navigate(event,window,cx);}}))}>
                            <TextInput show_label={false} height={Some(px(30.))} availability={if self.busy||self.uncertain{InputAvailability::ReadOnly}else{InputAvailability::Enabled}} placeholder={"Search branches…".into()} {..TextInput::new("cherry-pick-search",&self.query,"Search destination branches")}/>
                        </div>
                        <div id="destination-branches" role={gpui::accesskit::Role::ListBox} aria-label="Destination branches" class="h-[180px] min-h-0 shrink-0 relative px-1.5" style={|s|s.track_focus(&self.list_focus).on_key_down(cx.listener(|this,event,window,cx|this.navigate(event,window,cx)))}>
                            {list}
                            if self.visible(cx).is_empty(){<p class="absolute inset-0 text-small text-muted-ink">{if self.read_job.is_some(){"Loading branches…"}else{"No available matching local branches"}}</p>}
                        </div>
                    }
                    <p class="shrink-0 text-small text-muted-ink">{if cherry{summary}else{"Creates a new commit that reverses these changes. Existing history stays intact, including published commits.".into()}}</p>
                    }
                    if let Some(error)=error{<div role={gpui::accesskit::Role::Alert} class="flex-1 min-h-0 overflow-y-scroll"><p class="text-caption text-danger">{error}</p></div>}
                    <div class={if reset{"shrink-0 flex flex-row justify-end gap-1"}else{"shrink-0 flex flex-row justify-end gap-2"}}>
                        <Button focus={Some(self.cancel_focus.clone())} variant={ButtonVariant::Secondary} size={if reset{ControlSize::Small}else{ControlSize::Medium}} state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.read_job=None;this.deadline=None;this.dialog.update(cx,|dialog,cx|dialog.close(window,cx));})))} {..Button::new("replay-cancel","Cancel")}/>
                        <Button variant={ButtonVariant::Primary} size={if reset{ControlSize::Small}else{ControlSize::Medium}} state={if self.busy{ControlState::Busy}else if blocked{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))} {..Button::new("replay-submit",if reset&&self.busy{"Resetting…"}else{label})}/>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}

#[cfg(all(test, feature = "test-support"))]
mod native_tests {
    use super::*;
    use crate::workspace::tests::Fixture;

    struct Host {
        host: DialogHostState,
        form: gpui::Entity<Form>,
        actions: Vec<Action>,
        _event: gpui::Subscription,
    }

    impl Render for Host {
        fn render(
            &mut self,
            _: &mut gpui::Window,
            _: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            rake::view! {<onegit_ui::DialogHost state={self.host.clone()} body={gpui::div().size_full().into_any_element()}>{self.form.clone()}</onegit_ui::DialogHost>}
        }
    }

    fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Host>) {
        for _ in 0..3 {
            cx.run_until_parked();
            cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
                .unwrap();
        }

        cx.run_until_parked();
    }

    fn setup(f: &Fixture, kind: Kind) -> (gpui::TestAppContext, gpui::WindowHandle<Host>) {
        let source = f.load();

        let commit = Arc::new(
            source
                .repository
                .commit(if kind == Kind::Reset { "HEAD^" } else { "HEAD" }, None)
                .unwrap(),
        );

        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| onegit_ui::Theme::light().install(cx));
        let v = cx.open_window(gpui::size(px(800.), px(650.)), |window, cx| {
            let host = DialogHostState::new(cx);
            let form = cx.new(|cx| Form::new(&host, window, cx));

            let event = cx.subscribe(&form, |this: &mut Host, _, event: &Submit, _| {
                this.actions.push(event.0.clone())
            });

            form.update(cx, |form, cx| {
                form.configure(Some(source.clone()), false, cx);
                form.open(
                    source,
                    &Open {
                        kind,
                        commits: vec![commit],
                    },
                    window,
                    cx,
                );
            });

            Host {
                host,
                form,
                actions: Vec::new(),
                _event: event,
            }
        });

        draw(&mut cx, v);

        (cx, v)
    }

    #[test]
    fn cherry_pick_filters_destinations_and_search_and_submits_exact_consent_only_once() {
        let f = Fixture::new();

        f.write("a", "base");
        f.commit();
        f.git(&["branch", "target"]);
        f.git(&["branch", "other"]);
        let linked = f.directory.path().join("linked");

        f.git(&[
            "worktree",
            "add",
            "-b",
            "occupied",
            linked.to_str().unwrap(),
        ]);
        f.write("a", "feature");
        f.commit();
        let (mut cx, v) = setup(&f, Kind::CherryPick);

        v.update(&mut cx, |host, _, cx| {
            host.form.update(cx, |form, cx| {
                assert!(form.is_open(cx));
                assert_eq!(form.branches.len(), 2);
                assert!(
                    form.branches
                        .iter()
                        .all(|b| b.name != "main" && b.name != "occupied")
                );
                form.submit(cx);
                assert!(!form.busy, "destination needs explicit selection");
                form.query
                    .update(cx, |input, cx| input.set_text("TARG", cx));
            })
        })
        .unwrap();
        draw(&mut cx, v);
        v.update(&mut cx, |host, window, cx| {
            host.form.update(cx, |form, cx| {
                assert_eq!(form.visible(cx).len(), 1);
                let branch = &form.branches[form.visible(cx)[0]];

                form.selected = Some((branch.name.clone(), branch.oid.clone()));
                form.submit(cx);
                form.submit(cx);
                assert!(form.busy);
                form.finish(Err("Needs inspection".into()), window, cx);
                form.submit(cx);
                assert!(!form.busy, "failed intent cannot replay");
            })
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, _| {
            assert_eq!(host.actions.len(), 1);
            assert!(matches!(&host.actions[0],Action::CherryPick{destination:(branch,_),..} if branch=="target"));
        })
        .unwrap();
    }

    #[test]
    fn changed_branch_disables_revert_without_replacing_review_and_reduced_motion_settles() {
        let f = Fixture::new();

        f.write("a", "base");
        f.commit();
        let (mut cx, v) = setup(&f, Kind::Revert);

        cx.update(|cx| cx.set_reduce_motion(true));
        f.write("a", "new");
        f.commit();
        let source = f.load();

        v.update(&mut cx, |host, _, cx| {
            host.form.update(cx, |form, cx| {
                form.configure(Some(source), false, cx);
                assert!(form.reason().unwrap().contains("branch changed"));
                form.submit(cx);
                assert!(!form.busy);
                let time = cx
                    .background_executor()
                    .now()
                    .saturating_duration_since(form.epoch);

                assert!(!form.opacity.sample(time, true).is_animating());
                assert!(!form.height.sample(time, true).is_animating());
            })
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, _| assert!(host.actions.is_empty()))
            .unwrap();
    }

    #[test]
    fn reset_reviews_without_writes_focuses_cancel_and_emits_one_frozen_intent() {
        let f = Fixture::new();

        f.write("a", "base");
        f.commit();
        let target = f.load().snapshot.status.head.oid.clone().unwrap();

        f.write("a", "later");
        f.commit();
        let expected = f.load().snapshot.status.head.oid.clone();
        let (mut cx, v) = setup(&f, Kind::Reset);

        assert!(f.git(&["for-each-ref", "refs/1git/reset/"]).is_empty());
        v.update(&mut cx, |host, window, cx| {
            host.form.update(cx, |form, cx| {
                assert!(
                    form.cancel_focus.is_focused(window),
                    "initial focus must not accept reset"
                );
                assert_eq!(form.reset_plan.as_ref().unwrap().commit_count, 1);
                form.submit(cx);
                form.submit(cx);
                assert!(form.busy);
                form.finish(Err("The result needs inspection".into()), window, cx);
                assert!(form.is_open(cx));
                form.submit(cx);
                assert!(!form.busy, "renewed consent required after any failure");
                assert!(form.reset_plan.is_none());
            });
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, _| {
            assert_eq!(host.actions.len(), 1);

            let Action::Reset(review) = &host.actions[0] else {
                panic!("reset intent")
            };

            assert_eq!(review.commit.oid, target);
            assert_eq!(review.expected.oid, expected);
        })
        .unwrap();
        assert_eq!(
            f.load().snapshot.status.head.oid,
            expected,
            "form never writes Git directly"
        );
    }

    #[test]
    fn reset_published_review_and_later_branch_changes_disable_submission() {
        for published in [false, true] {
            let f = Fixture::new();

            f.write("a", "base");
            f.commit();
            f.write("a", "later");
            f.commit();
            let old = f.load().snapshot.status.head.oid.clone().unwrap();

            if published {
                f.git(&["update-ref", "refs/remotes/origin/main", &old]);
            }

            let (mut cx, v) = setup(&f, Kind::Reset);

            f.git(&["switch", "-c", "external"]);
            let source = f.load();

            v.update(&mut cx, |host, _, cx| {
                host.form.update(cx, |form, cx| {
                    if published {
                        assert!(form.error.as_ref().unwrap().contains("published"));
                        assert!(form.reset_plan.is_none());
                    }

                    form.configure(Some(source), false, cx);
                    assert_eq!(
                        form.review.as_ref().unwrap().expected.oid.as_deref(),
                        Some(old.as_str())
                    );
                    assert_eq!(
                        form.review.as_ref().unwrap().expected.branch.as_deref(),
                        Some("main")
                    );
                    assert!(form.reason().is_some());
                    form.submit(cx);
                    assert!(!form.busy);
                });
            })
            .unwrap();
            draw(&mut cx, v);
            v.read_with(&cx, |host, _| assert!(host.actions.is_empty()))
                .unwrap();
            assert!(f.git(&["for-each-ref", "refs/1git/reset/"]).is_empty());
        }
    }

    #[test]
    fn dismissing_a_pending_reset_cancels_its_read_and_late_completion() {
        let f = Fixture::new();

        f.write("a", "base");
        f.commit();
        f.write("a", "later");
        f.commit();
        let (mut cx, v) = setup(&f, Kind::Reset);
        let source = f.load();
        let commit = Arc::new(source.repository.commit("HEAD^", None).unwrap());

        v.update(&mut cx, |host, window, cx| {
            host.form.update(cx, |form, cx| {
                form.open(
                    source,
                    &Open {
                        kind: Kind::Reset,
                        commits: vec![commit],
                    },
                    window,
                    cx,
                );
                let cancel = form.read_job.as_ref().unwrap().cancel.clone();

                form.dialog
                    .update(cx, |dialog, cx| dialog.close(window, cx));
                form.read_job = None;
                form.deadline = None;
                assert!(cancel.is_cancelled());
            });
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, cx| {
            let form = host.form.read(cx);

            assert!(!form.is_open(cx));
            assert!(form.reset_plan.is_none());
            assert!(form.deadline.is_none());
            assert!(host.actions.is_empty());
        })
        .unwrap();
    }
}
