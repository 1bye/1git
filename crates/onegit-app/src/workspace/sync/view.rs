use super::{Action, Sync, model};
use gpui_ce_motion::{Easing, Transition};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogDismissal, DialogPresentation,
    Icon, IconName, IconSize, ListRow, ListRowVariant, RowSelection, Text, TextRole, TextTone,
};

use rake::gpui::{self, prelude::*, px};
use std::time::Duration;

impl gpui::Render for Sync {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        if !self.dialog.read(cx).is_open() {
            return gpui::Empty.into_any_element();
        }

        let busy = self.busy();
        let ready = !busy && self.read.is_none() && !self.needs_review;
        let review = self.review.clone();

        let branch = self
            .source
            .as_ref()
            .and_then(|source| source.snapshot.status.head.branch.as_deref())
            .unwrap_or("Detached HEAD");

        let head = self
            .source
            .as_ref()
            .map(|source| &source.snapshot.status.head);

        let title: String = if self.publishing {
            "Publish branch".into()
        } else if self.stopping {
            "Stopping…".into()
        } else if let Some(action) = self.pending {
            action.pending().into()
        } else {
            "Synchronization".into()
        };

        let progress = self.progress.map(model::progress_label);
        let error = self.error.clone();

        let message=error.clone().unwrap_or_else(|| {
            if self.read.is_some() {"Reading remotes…".into()}
            else if busy {"The operation continues if you close this dialog.".into()}
            else if self.publishing {format!("Choose where to publish {branch}.")}
            else {self.notice.clone().unwrap_or_else(||"Choose an action. Fetch updates remote status; Pull only fast-forwards. Push sends this branch’s reviewed commit.".into())}
        });

        let unavailable = if ready {
            review
                .as_ref()
                .and_then(|review| {
                    review.blocked(if self.publishing {
                        Action::Publish
                    } else {
                        Action::Push
                    })
                })
                .map(str::to_owned)
        } else {
            None
        };

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let remote_count = review.as_ref().map_or(0, |review| review.remotes.len());

        let choices =
            (remote_count as f64 * 40. + remote_count.saturating_sub(1) as f64 * 8.).min(180.);

        let target_height: f64 = if self.publishing {
            128. + choices
                + if self.fetched_at.is_some() { 26. } else { 0. }
                + if progress.is_some() { 28. } else { 0. }
        } else {
            350.
        } + if error.is_some() { 88. } else { 0. };

        let height = target_height
            .min(f64::from(window.viewport_size().height) - 32.)
            .max(80.);

        let width = if self.publishing { 400. } else { 340. };
        let transition = Transition::Tween(Duration::from_millis(160), Easing::EaseOut);

        self.height.animate(height, transition, time);
        self.width.animate(width, transition, time);
        self.opacity.animate(1., transition, time);
        let height = self.height.sample(time, cx.reduce_motion());
        let width = self.width.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        if height.is_animating() || width.is_animating() || opacity.is_animating() {
            window.request_animation_frame();
        }

        let width = px(width.value() as f32).min(window.viewport_size().width - px(32.));
        let height = px(height.value() as f32);

        rake::view! {
            <Dialog width={width} presentation={DialogPresentation::Compact{height}} dismissal={DialogDismissal::EscapeAndOutside} initial_focus={Some(self.close_focus.clone())}
                {..Dialog::new("rail-sync-dialog",&self.dialog,if self.publishing{"Publish branch"}else{"Synchronization status"})}>
                <div class="size-full flex flex-col gap-3 p-4 min-h-0" style={|s|s.opacity(opacity.value()as f32).debug_selector(||"sync-panel".into())}>
                    <p role={gpui::accesskit::Role::Heading} aria-label={title.clone()} class="text-[14px] leading-5 font-normal" style={|s|s.aria_level(2)}>{title}</p>
                    <div class={if self.publishing{"flex-1 min-h-0 flex flex-col gap-3 overflow-y-scroll"}else{"flex-1 min-h-0 flex flex-col gap-2 overflow-y-scroll"}}>
                        if !self.publishing {
                        <div class="flex flex-col gap-2 shrink-0" style={|s|s.debug_selector(||"sync-identity".into())}>
                        <Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("sync-branch",format!("Branch: {branch}"))}/>
                        if let Some(head)=head {
                            <Text role={TextRole::Small} {..Text::new("sync-counts",if head.upstream.is_some(){format!("↓ {} incoming · ↑ {} outgoing · {}",head.behind,head.ahead,head.upstream.as_deref().unwrap_or(""))}else{"No upstream configured".into()})}/>
                        }
                        </div>
                        }
                        <div role={if error.is_some(){gpui::accesskit::Role::Alert}else{gpui::accesskit::Role::Status}} aria-label={message.clone()} style={|s|s.debug_selector(||"rail-sync-message".into())}>
                            <Text role={TextRole::Small} tone={if error.is_some(){TextTone::Danger}else{TextTone::Muted}} {..Text::new("sync-message",message)}/>
                        </div>
                        if let Some(progress)=progress {<Text role={TextRole::Small} {..Text::new("transfer-progress",progress)}/>}
                        if let Some(fetched)=self.fetched_at {<Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("last-fetch",format!("Fetched {}",super::super::branches::model::commit_age(Some(&chrono::DateTime::from_timestamp_millis(fetched).expect("current timestamp").to_rfc3339()),chrono::Utc::now().timestamp_millis())))}/>}
                        if let Some(unavailable)=unavailable {<Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("sync-unavailable",unavailable)}/>}
                        if self.publishing {
                            if let Some(review)=&review {
                                <div role={gpui::accesskit::Role::Group} aria-label="Remote destination" class="flex flex-col gap-2 max-h-[180px] overflow-y-scroll shrink-0">
                                for remote in &review.remotes {
                                    <div id={remote.name.clone()} class="shrink-0" style={|s|{let name=remote.name.clone();s.debug_selector(move||format!("publish-remote-{name}"))}}>
                                        <ListRow variant={ListRowVariant::Choice} selection={if self.remote.as_deref()==Some(&remote.name){RowSelection::Selected}else{RowSelection::Unselected}}
                                            state={if ready&&remote.push_urls.len()==1{ControlState::Enabled}else{ControlState::Disabled}}
                                            trailing={if self.remote.as_deref()==Some(&remote.name){Some(rake::view!{<Icon size={IconSize::Supporting} {..Icon::new("chosen-remote",IconName::Check)}/>}.into_any_element())}else{None}}
                                            on_press={Some(Box::new(cx.listener({let name=remote.name.clone();move|this,_,_,cx|this.select_remote(name.clone(),cx)})))}
                                            {..ListRow::new("remote",remote.name.clone())}/>
                                    </div>
                                }
                                </div>
                            }
                        } else if let Some(review)=&review {
                            for action in [Action::Fetch,Action::Pull,Action::Push] {
                                <div id={action.label()} class="flex flex-row items-start gap-2 shrink-0" style={|s|s.debug_selector(move||format!("sync-action-{}",action.label().to_lowercase()))}>
                                    <Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if ready&&review.blocked(action).is_none(){ControlState::Enabled}else{ControlState::Disabled}}
                                        on_press={Some(Box::new(cx.listener(move|this,_,_,cx|this.submit(action,cx))))}
                                        {..Button::new("action",action.label())}/>
                                    <div class="flex-1 min-w-0"><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("action-description",review.blocked(action).unwrap_or(match action {Action::Fetch=>"Update remote refs; keep local files.",Action::Pull=>"Fast-forward this branch from its upstream.",_=>"Send this branch to its exact upstream."}))}/></div>
                                </div>
                            }
                            if review.blocked(Action::Publish).is_none() {<Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if ready{ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.begin_publish(cx))))} {..Button::new("review-publish-branch","Publish branch…")}/>}
                        }
                    </div>
                    <div class="flex flex-row justify-end items-center gap-2 shrink-0" style={|s|s.debug_selector(||"sync-footer".into())}>
                        <Button focus={Some(self.close_focus.clone())} size={ControlSize::Small} variant={ButtonVariant::Secondary} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close(window,cx))))} {..Button::new("rail-sync-close","Close")}/>
                        if busy {<Button size={ControlSize::Small} state={if self.stopping{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.stop(cx))))} {..Button::new("rail-sync-stop",if self.stopping{"Stopping…"}else{"Stop"})}/>}
                        else if self.publishing {
                            <Button size={ControlSize::Small} state={if ready&&self.remote.is_some(){ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(Action::Publish,cx))))} {..Button::new("confirm-publish",format!("Publish to {}",self.remote.as_deref().unwrap_or("remote")))}/>
                        } else {<Button size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if self.read.is_some(){ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.load(cx))))} {..Button::new("rail-sync-refresh","Refresh status")}/>}
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}
