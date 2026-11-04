//! Frozen range review, editable squash message and oldest-first ordering before one explicit write.
use super::{Action, Kind, Open, RangeReview, Review, Submit, consecutive, unavailable};

use crate::workspace::{
    ReadJob,
    read::{self, Loaded},
};

use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::{BranchIdentity, Cancellation, CommitInfo, HistoryRewritePlan};

use onegit_ui::{
    Button, ButtonVariant, CommitSubject, ControlSize, ControlState, Dialog, DialogAvailability,
    DialogDismissal, DialogHostState, DialogPresentation, DialogState, InputAvailability,
    InputEvent, InputState, TextArea, TextInput,
};

use rake::gpui::{self, AppContext, Focusable, prelude::*, px};

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) struct Form {
    dialog: gpui::Entity<DialogState>,
    review: Option<RangeReview>,
    kind: Kind,
    source: Option<Arc<Loaded>>,
    blocked: bool,
    busy: bool,
    uncertain: bool,
    error: Option<String>,
    plan: Option<HistoryRewritePlan>,
    summary: gpui::Entity<InputState>,
    description: gpui::Entity<InputState>,
    order: Vec<Arc<CommitInfo>>,
    selected: Option<String>,
    read_job: Option<ReadJob>,
    deadline: Option<gpui::Task<()>>,
    write_deadline: Option<gpui::Task<()>>,
    scroll: gpui::UniformListScrollHandle,
    list_focus: gpui::FocusHandle,
    cancel_focus: gpui::FocusHandle,
    epoch: Instant,
    opacity: MotionValue,
    height: MotionValue,
    positions: HashMap<String, MotionValue>,
    drag: Option<Drag>,
    _events: Vec<gpui::Subscription>,
}

struct Drag {
    id: String,
    y: gpui::Pixels,
    from: usize,
    original: Vec<Arc<CommitInfo>>,
}

impl gpui::EventEmitter<Submit> for Form {}

impl Form {
    pub fn new(
        host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let summary = cx.new(|cx| InputState::new("", window, cx));
        let description = cx.new(|cx| InputState::new("", window, cx));

        let events = [&summary, &description]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();

        Self {
            dialog: host.dialog(cx),
            review: None,
            kind: Kind::Squash,
            source: None,
            blocked: true,
            busy: false,
            uncertain: false,
            error: None,
            plan: None,
            summary,
            description,
            order: vec![],
            selected: None,
            read_job: None,
            deadline: None,
            write_deadline: None,
            scroll: gpui::UniformListScrollHandle::new(),
            list_focus: cx.focus_handle(),
            cancel_focus: cx.focus_handle(),
            epoch: cx.background_executor().now(),
            opacity: MotionValue::new(0.),
            height: MotionValue::new(352.),
            positions: HashMap::new(),
            drag: None,
            _events: events,
        }
    }

    pub fn configure(
        &mut self,
        source: Option<Arc<Loaded>>,
        blocked: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let identity = |source: &Arc<Loaded>| {
            (
                source.snapshot.repository.root.clone(),
                BranchIdentity::from_snapshot(&source.snapshot),
                source.snapshot.operation,
                source.snapshot.status.files.len(),
            )
        };

        let changed = self.blocked != blocked
            || self.source.as_ref().map(identity) != source.as_ref().map(identity);

        self.source = source;
        self.blocked = blocked;

        if changed {
            cx.notify();
        }
    }

    pub fn open(
        &mut self,
        source: Arc<Loaded>,
        event: &Open,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked || !event.kind.is_rewrite() || !consecutive(&event.commits) {
            return;
        }

        self.read_job = None;
        self.deadline = None;
        self.write_deadline = None;
        self.kind = event.kind;
        self.source = Some(source.clone());
        self.error = None;
        self.plan = None;
        self.uncertain = false;
        self.drag = None;
        let review = RangeReview {
            source: Review::new(&source, event.commits[0].clone()),
            commits: event.commits.clone(),
        };

        self.order = review.commits.iter().rev().cloned().collect();
        self.selected = self.order.first().map(|c| c.oid.clone());
        let message = self
            .order
            .iter()
            .map(|c| {
                if c.body.is_empty() {
                    c.summary.as_str()
                } else {
                    c.body.as_str()
                }
            })
            .collect::<Vec<_>>()
            .join(
                "

",
            );

        let (summary, description) = message.split_once('\n').unwrap_or((&message, ""));

        self.summary
            .update(cx, |input, cx| input.set_text(summary, cx));
        self.description
            .update(cx, |input, cx| input.set_text(description.trim_start(), cx));
        self.positions = self
            .order
            .iter()
            .enumerate()
            .map(|(i, c)| (c.oid.clone(), MotionValue::new(i as f64 * 48.)))
            .collect();
        self.review = Some(review.clone());
        self.scroll.scroll_to_item(0, gpui::ScrollStrategy::Top);
        self.epoch = cx.background_executor().now();
        self.opacity = MotionValue::new(0.);
        self.height = MotionValue::new(self.base_height());
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        let kind = self.kind;
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let completion_cancel = cancel.clone();

        let worker = cx.background_executor().spawn(async move {
            if kind == Kind::Squash {
                source
                    .repository
                    .squash_plan(&review.squash(String::new()), Some(&worker_cancel))
            } else {
                source.repository.reorder_plan(
                    &review.reorder(review.commits.iter().rev().map(|c| c.oid.clone()).collect()),
                    Some(&worker_cancel),
                )
            }
            .map_err(read::message)
        });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !completion_cancel.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.deadline = None;
                    this.read_job = None;

                    match result {
                        Ok(plan) => this.plan = Some(plan),
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
                    Some("Could not review these commits. Cancel and refresh History.".into());
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn reason(&self) -> Option<&str> {
        let review = self.review.as_ref()?;

        let Some(source) = &self.source else {
            return Some("The repository is unavailable. Cancel and review again.");
        };

        if !review.source.matches(source) {
            return Some("The repository changed or is unavailable. Cancel and review again.");
        }

        if self.blocked {
            return Some("The repository is busy or needs a refresh.");
        }

        unavailable(source)
    }

    fn editable(&self) -> bool {
        !self.busy
            && !self.uncertain
            && self.error.is_none()
            && self.plan.is_some()
            && self.reason().is_none()
    }

    fn changed(&self) -> bool {
        self.review.as_ref().is_some_and(|r| {
            self.order
                .iter()
                .rev()
                .map(|c| &c.oid)
                .ne(r.commits.iter().map(|c| &c.oid))
        })
    }

    fn can_move(&self, step: isize) -> bool {
        if !self.editable() {
            return false;
        }

        let Some(from) = self
            .order
            .iter()
            .position(|c| Some(&c.oid) == self.selected.as_ref())
        else {
            return false;
        };

        let Some(to) = from
            .checked_add_signed(step)
            .filter(|i| *i < self.order.len())
        else {
            return false;
        };

        let root = self.order.first().is_some_and(|c| c.parent_oids.is_empty());

        from != to && (!root || (from > 0 && to > 0))
    }

    fn move_by(&mut self, step: isize, cx: &mut gpui::Context<Self>) {
        if !self.can_move(step) {
            return;
        }

        let from = self
            .order
            .iter()
            .position(|c| Some(&c.oid) == self.selected.as_ref())
            .expect("movable selection");

        let to = from.checked_add_signed(step).expect("bounded destination");
        let commit = self.order.remove(from);

        self.order.insert(to, commit);
        self.scroll
            .scroll_to_item(to, gpui::ScrollStrategy::Nearest);
        cx.notify();
    }

    fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.editable() {
            return;
        }

        let Some(review) = self.review.clone() else {
            return;
        };

        let cancel = Cancellation::default();

        let action = if self.kind == Kind::Squash {
            let summary = self.summary.read(cx).text();

            if summary.trim().is_empty() {
                return;
            }

            let description = self.description.read(cx).text();

            let message = if description.is_empty() {
                summary.to_owned()
            } else {
                format!(
                    "{summary}

{description}"
                )
            };

            Action::Squash {
                review,
                message,
                cancel: cancel.clone(),
            }
        } else {
            if !self.changed() {
                return;
            }

            Action::Reorder {
                review,
                order: self.order.iter().map(|c| c.oid.clone()).collect(),
                cancel: cancel.clone(),
            }
        };

        self.drag = None;
        self.busy = true;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Busy, cx)
        });
        // Match the source's two-minute write deadline without cancelling an atomic ref install.
        self.write_deadline = Some(cx.spawn(async move |_, cx| {
            cx.background_executor()
                .timer(Duration::from_secs(120))
                .await;
            cancel.cancel();
        }));
        cx.emit(Submit(action));
        cx.notify();
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.busy {
            return;
        }

        self.busy = false;
        self.write_deadline = None;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => {
                self.dialog
                    .update(cx, |dialog, cx| dialog.close(window, cx));
            }
            Err(error) => {
                self.error = Some(error);
                self.plan = None;
                self.uncertain = true;
            }
        }

        cx.notify();
    }

    #[cfg(test)]
    pub(super) fn is_open(&self, cx: &gpui::App) -> bool {
        self.dialog.read(cx).is_open()
    }

    fn cancel(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.busy {
            return;
        }

        self.read_job = None;
        self.deadline = None;
        self.drag = None;
        self.dialog
            .update(cx, |dialog, cx| dialog.close(window, cx));
        cx.notify();
    }

    fn base_height(&self) -> f64 {
        if self.kind == Kind::Squash {
            316. + (self.order.len() as f64 * 20. - 4.).clamp(0., 150.)
        } else {
            216. + (self.order.len() as f64 * 48. + 6.).min(240.)
        }
    }

    fn navigate(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.order.is_empty() {
            return;
        }

        if event.keystroke.key == "escape"
            && let Some(drag) = self.drag.take()
        {
            self.order = drag.original;
            window.prevent_default();
            cx.stop_propagation();
            cx.notify();

            return;
        }

        let mut modifiers = event.keystroke.modifiers;

        modifiers.alt = false;

        if modifiers.modified() {
            return;
        }

        let step = match event.keystroke.key.as_str() {
            "up" => -1,
            "down" => 1,
            _ => return,
        };

        if event.keystroke.modifiers.alt {
            self.move_by(step, cx);
        } else {
            let at = self
                .order
                .iter()
                .position(|c| Some(&c.oid) == self.selected.as_ref())
                .unwrap_or(0);

            let next = at.saturating_add_signed(step).min(self.order.len() - 1);

            self.selected = Some(self.order[next].oid.clone());
            self.scroll
                .scroll_to_item(next, gpui::ScrollStrategy::Nearest);
            cx.notify();
        }

        window.prevent_default();
        cx.stop_propagation();
    }

    fn drag_to(&mut self, event: &gpui::MouseMoveEvent, cx: &mut gpui::Context<Self>) {
        if !self.editable() || event.pressed_button != Some(gpui::MouseButton::Left) {
            self.drag = None;

            return;
        }

        let Some(drag) = &self.drag else {
            return;
        };

        let delta = f32::from(event.position.y - drag.y);
        let root = self.order.first().is_some_and(|c| c.parent_oids.is_empty());

        let target = (drag.from as isize + (delta / 48.).round() as isize).clamp(
            isize::from(root),
            self.order.len().saturating_sub(1) as isize,
        ) as usize;

        let Some(current) = self.order.iter().position(|c| c.oid == drag.id) else {
            return;
        };

        if current != target {
            self.move_by(target as isize - current as isize, cx);
        }
    }
}

impl Render for Form {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        if !self.dialog.read(cx).is_open() {
            self.read_job = None;
            self.deadline = None;
            self.drag = None;

            return gpui::Empty.into_any_element();
        }

        if !window.is_window_active()
            && let Some(drag) = self.drag.take()
        {
            self.order = drag.original;
        }

        let error = self
            .error
            .as_deref()
            .or_else(|| if self.busy { None } else { self.reason() })
            .map(str::to_owned);

        let squash = self.kind == Kind::Squash;

        let disabled = !self.editable()
            || if squash {
                self.summary.read(cx).text().trim().is_empty()
            } else {
                !self.changed()
            };

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let transition = Transition::Tween(Duration::from_millis(120), Easing::EaseOut);

        self.opacity.animate(1., transition, time);
        let error_height = error.as_ref().map_or(0., |message| {
            let run = gpui::TextRun {
                len: message.len(),
                font: window.text_style().font(),
                ..Default::default()
            };

            let height = window
                .text_system()
                .shape_text(message.clone(), px(12.), &[run], Some(px(424.)), None)
                .map(|lines| {
                    lines
                        .iter()
                        .map(|line| f32::from(line.size(px(18.)).height))
                        .sum::<f32>()
                })
                .unwrap_or(64.);

            f64::from(height.min(144.)) + 12. - if self.plan.is_none() { 28. } else { 0. }
        });

        self.height
            .animate(self.base_height() + error_height, transition, time);
        let opacity = self.opacity.sample(time, cx.reduce_motion());
        let height = self.height.sample(time, cx.reduce_motion());
        let mut animating = opacity.is_animating() || height.is_animating();

        let rows: Vec<_> = self
            .order
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let position = self
                    .positions
                    .entry(c.oid.clone())
                    .or_insert_with(|| MotionValue::new(i as f64 * 48.));

                position.animate(i as f64 * 48., transition, time);
                let sample = position.sample(time, cx.reduce_motion());

                animating |= sample.is_animating();

                (c.clone(), (sample.value() - i as f64 * 48.) as f32)
            })
            .collect();

        if animating {
            window.request_animation_frame();
        }

        let rows = Arc::new(rows);
        let selected = self.selected.clone();
        let owns = self.list_focus.is_focused(window);
        let owner = cx.entity().downgrade();
        let focus = self.list_focus.clone();

        let list=gpui::uniform_list("rewrite-order",rows.len(),move|range,_,_|range.map(|i|{
            let (commit,offset)=&rows[i];let commit=commit.clone();let id=commit.oid.clone();let owner=owner.clone();let down=owner.clone();let drag_id=id.clone();let focus=focus.clone();
            let active=selected.as_ref()==Some(&id);

            rake::view!{
                <div class="h-[48px] w-full min-w-0 relative px-1.5" style={|s|s.top(px(*offset))}>
                    <div id={commit.oid.clone()} role={gpui::accesskit::Role::ListBoxOption} aria-label={format!("{} · {} · {}{}",commit.summary,&commit.oid[..7],commit.author.name,if commit.parent_oids.is_empty(){" · Root commit"}else{""})}
                        class="size-full min-w-0 flex flex-col justify-center gap-0.5 px-2 border-1 rounded-[6px] overflow-hidden"
                        style={|s|s.border_color(gpui::rgba(0)).debug_selector(move||format!("rewrite-row-{i}")).aria_selected(active).when(active&&owns,|s|s.aria_active_descendant()).when(active,|s|s.bg(onegit_ui::Theme::current().selection)).cursor_pointer()
                            .on_mouse_down(gpui::MouseButton::Left,move|event,window,cx|{
                                window.focus(&focus,cx);let _=down.update(cx,|this,cx|{
                                    if this.busy{return;}
                                    this.selected=Some(drag_id.clone());
                                    if this.editable() && !(i==0&&this.order[0].parent_oids.is_empty()){
                                        this.drag=Some(Drag{id:drag_id.clone(),y:event.position.y,from:i,original:this.order.clone()});
                                    }cx.notify();
                                });
                            })}
                        on:click={move|_,_,cx|{let _=owner.update(cx,|this,cx|{if !this.busy{this.selected=Some(id.clone());cx.notify();}});}}>
                        <CommitSubject {..CommitSubject::new("subject",commit.summary.clone())}/>
                        <p class="text-caption text-muted-ink" wrap={false} ellipsis={true}>{format!("{} · {}{}",&commit.oid[..7],commit.author.name,if commit.parent_oids.is_empty(){" · Root commit"}else{""})}</p>
                    </div>
                </div>
            }.into_any_element()
        }).collect()).size_full().track_scroll(&self.scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        let summary_rows = self.order.clone();

        let summaries=gpui::uniform_list("squash-commits",summary_rows.len(),move|range,_,_|range.map(|i|{
            let commit=&summary_rows[i];

            rake::view!{<p id={commit.oid.clone()} class="h-[20px] text-small" wrap={false} ellipsis={true}>{format!("{} · {}",&commit.oid[..7],commit.summary)}</p>}.into_any_element()
        }).collect()).size_full().with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        let guidance = if let Some(plan) = &self.plan {
            if plan.replay.is_empty() {
                if squash {
                    "Combine into one commit. Files stay unchanged.".into()
                } else {
                    "Commit IDs may change. Files stay unchanged.".into()
                }
            } else {
                format!(
                    "{} later {} {} Files stay unchanged.",
                    plan.replay.len(),
                    if plan.replay.len() == 1 {
                        "commit will"
                    } else {
                        "commits will"
                    },
                    if squash {
                        "be replayed with new IDs."
                    } else {
                        "also be replayed."
                    }
                )
            }
        } else {
            "Reviewing commits…".into()
        };

        let earlier = self.can_move(-1);
        let later = self.can_move(1);
        let label = self.kind.title();

        rake::view!{
            <Dialog width={px(440.)} presentation={DialogPresentation::Compact{height:px(height.value()as f32)}} dismissal={DialogDismissal::EscapeAndOutside}
                availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}} initial_focus={Some(if squash{self.summary.read(cx).focus_handle(cx)}else{self.list_focus.clone()})}
                {..Dialog::new("rewrite-confirmation",&self.dialog,label)}>
                <div class="size-full min-h-0 flex flex-col gap-3 p-2 overflow-y-scroll" style={|s|s.opacity(opacity.value()as f32)}>
                    <p class="shrink-0 text-title" style={|s|s.font_weight(gpui::FontWeight::NORMAL)}>{format!("{} {} commits",if squash{"Squash"}else{"Reorder"},self.order.len())}</p>
                    if squash {
                        <div class="shrink-0 min-h-0" style={|s|s.h(px((self.order.len()as f32*20.-4.).clamp(0.,150.)))}>{summaries}</div>
                        <TextInput variant={onegit_ui::InputVariant::Surface} show_label={false} height={Some(px(30.))} availability={if self.busy{InputAvailability::ReadOnly}else{InputAvailability::Enabled}} {..TextInput::new("squash-summary",&self.summary,"Squash commit summary")}/>
                        <TextArea variant={onegit_ui::InputVariant::Surface} show_label={false} height={Some(px(110.))} availability={if self.busy{InputAvailability::ReadOnly}else{InputAvailability::Enabled}} {..TextArea::new("squash-message",&self.description,"Squash commit message")}/>
                    } else {
                        <p class="shrink-0 text-small text-muted-ink">"Oldest first · Select a commit to move"</p>
                        <div id="rewrite-order-list" role={gpui::accesskit::Role::ListBox} aria-label="Commit replay order, oldest first" class="shrink-0 min-h-0"
                            style={|s|s.h(px((self.order.len()as f32*48.+6.).min(240.))).track_focus(&self.list_focus)
                                .on_key_down(cx.listener(|this,event,window,cx|this.navigate(event,window,cx)))
                                .on_mouse_move(cx.listener(|this,event,_,cx|this.drag_to(event,cx)))
                                .on_mouse_up(gpui::MouseButton::Left,cx.listener(|this,_,_,cx|{if this.drag.take().is_some(){cx.notify();}}))
                                .on_mouse_up_out(gpui::MouseButton::Left,cx.listener(|this,_,_,cx|{if let Some(drag)=this.drag.take(){this.order=drag.original;cx.notify();}}))}>
                            {list}
                        </div>
                        <div class="shrink-0 flex flex-row gap-1">
                            <Button variant={ButtonVariant::Secondary} size={ControlSize::Small} state={if earlier{ControlState::Enabled}else{ControlState::Disabled}}
                                on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.move_by(-1,cx))))} {..Button::new("reorder-earlier","Move earlier")}/>
                            <Button variant={ButtonVariant::Secondary} size={ControlSize::Small} state={if later{ControlState::Enabled}else{ControlState::Disabled}}
                                on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.move_by(1,cx))))} {..Button::new("reorder-later","Move later")}/>
                        </div>
                    }
                    if self.plan.is_some()||error.is_none(){<p class="shrink-0 text-small text-muted-ink">{guidance}</p>}
                    <p class="shrink-0 text-caption text-muted-ink">{if squash{"Only unpublished history. Fetch first if another tool may have pushed. Originals are retained; existing tags and other branches stay unchanged."}else{"Only unpublished history. Fetch first if another tool may have pushed. Original history is retained; tags and other branches stay unchanged."}}</p>
                    if let Some(error)=error {<div role={gpui::accesskit::Role::Alert} class="flex-1 min-h-0 overflow-y-scroll"><p class="text-body text-danger">{error}</p></div>}
                    <div class="shrink-0 flex flex-row justify-end gap-1">
                        <Button focus={Some(self.cancel_focus.clone())} variant={ButtonVariant::Secondary} size={ControlSize::Small} state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.cancel(window,cx))))} {..Button::new("rewrite-cancel","Cancel")}/>
                        <Button variant={ButtonVariant::Primary} size={ControlSize::Small} state={if self.busy{ControlState::Busy}else if disabled{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))} {..Button::new("rewrite-submit",if self.busy{if squash{"Squashing…"}else{"Reordering…"}}else{label})}/>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}

#[cfg(all(test, feature = "test-support"))]
#[path = "rewrite_tests.rs"]
mod tests;
