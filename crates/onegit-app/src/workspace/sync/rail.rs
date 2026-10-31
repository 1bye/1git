//! A retained rail view samples GPU-painted progress without rerendering repository diffs.
use super::super::read::Loaded;
use super::{Sync, model};
use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::TransferPhase;
use onegit_ui::{Icon, IconName, IconSize, Theme, Tooltip};
use rake::gpui::{self, ColorExt, prelude::*, px};

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub(in crate::workspace) struct Rail {
    pub state: gpui::Entity<Sync>,
    source: Option<Arc<Loaded>>,
    blocked: bool,
    epoch: Instant,
    fraction: MotionValue,
    sweep: MotionValue,
    forward: bool,
    _observe: gpui::Subscription,
}

impl Rail {
    pub fn new(state: gpui::Entity<Sync>, cx: &mut gpui::Context<Self>) -> Self {
        let observe = cx.observe(&state, |_, _, cx| cx.notify());

        Self {
            state,
            source: None,
            blocked: false,
            epoch: cx.background_executor().now(),
            fraction: MotionValue::new(0.),
            sweep: MotionValue::new(0.),
            forward: true,
            _observe: observe,
        }
    }

    pub fn configure(
        &mut self,
        source: Option<Arc<Loaded>>,
        blocked: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let same = match (&self.source, &source) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        };

        if !same || self.blocked != blocked {
            self.source = source;
            self.blocked = blocked;
            cx.notify();
        }
    }
}

fn arc(
    bounds: gpui::Bounds<gpui::Pixels>,
    start: f32,
    length: f32,
) -> Option<gpui::Path<gpui::Pixels>> {
    if length <= 0. {
        return None;
    }

    let sweep = std::f32::consts::PI * 1.5;

    let point = |position: f32| {
        let angle = std::f32::consts::PI * 0.75 + position * sweep;

        bounds.origin + gpui::point(px(16. + 10. * angle.cos()), px(12. + 10. * angle.sin()))
    };

    let mut path = gpui::PathBuilder::stroke(px(3.));

    path.move_to(point(start));
    path.arc_to(
        gpui::point(px(10.), px(10.)),
        px(0.),
        length * sweep > std::f32::consts::PI,
        true,
        point(start + length),
    );

    path.build().ok()
}

impl gpui::Render for Rail {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        let state = self.state.read(cx);
        let pending = state.pending;
        let value = state.progress;
        let failed = state.error.is_some();
        let complete = state.complete;
        let stopping = state.stopping;
        let source = self.source.clone();

        let (incoming, outgoing) = source.as_ref().map_or((0, 0), |source| {
            let head = &source.snapshot.status.head;

            if head.upstream.is_some() {
                (head.behind, head.ahead)
            } else {
                (0, 0)
            }
        });

        let counts = [(incoming, "incoming"), (outgoing, "outgoing")]
            .into_iter()
            .filter(|(count, _)| *count > 0)
            .map(|(count, label)| format!("{count} {label}"))
            .collect::<Vec<_>>()
            .join(", ");

        let status = if stopping {
            "Stopping…".into()
        } else if let Some(action) = pending {
            format!(
                "{} — {}",
                action.pending(),
                value.map_or_else(|| "Connecting…".into(), model::progress_label)
            )
        } else if failed {
            "Synchronization needs attention".into()
        } else if complete {
            state
                .notice
                .as_deref()
                .unwrap_or("Synchronization complete")
                .trim_end_matches('.')
                .to_owned()
        } else {
            "Fetch, pull and push".into()
        };

        let label = if counts.is_empty() {
            status
        } else {
            format!("{status} — {counts}")
        };

        let disabled = source.is_none() || (self.blocked && pending.is_none());
        let theme = Theme::current();
        let accent = theme.accent;

        let progress = if let Some(action) = pending {
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(self.epoch);

            let percent = value
                .filter(|value| {
                    matches!(
                        value.phase,
                        TransferPhase::Sending | TransferPhase::Receiving
                    )
                })
                .and_then(|value| value.percent)
                .map(|percent| percent.min(100));

            let (fraction, offset) = if let Some(percent) = percent {
                self.fraction.animate(
                    f64::from(percent) / 100.,
                    Transition::Tween(Duration::from_millis(120), Easing::EaseOut),
                    time,
                );
                let sample = self.fraction.sample(time, cx.reduce_motion());

                if sample.is_animating() {
                    window.request_animation_frame();
                }

                (sample.value() as f32, 0.)
            } else {
                self.sweep.animate(
                    if self.forward { 1. } else { 0. },
                    Transition::Tween(Duration::from_millis(500), Easing::EaseInOut),
                    time,
                );
                let sample = self.sweep.sample(time, cx.reduce_motion());

                if !sample.is_animating() && !cx.reduce_motion() {
                    self.forward = !self.forward;
                }

                if !cx.reduce_motion() {
                    window.request_animation_frame();
                }

                (0.24, 0.76 * sample.value() as f32)
            };

            let text = percent.map_or_else(|| "…".into(), |percent| format!("{percent}%"));
            let accessible = value.map_or_else(|| action.pending().into(), model::progress_label);

            rake::view! {
                <div role={gpui::accesskit::Role::ProgressIndicator} aria-label="Repository synchronization"
                    class="relative size-[32px]" style={|s|s.aria_value(accessible).text_color(theme.accent).debug_selector(||"rail-sync-progress".into()).a11y_synthetic_children(move|builder| {
                        let node=builder.parent_node();
                        if let Some(percent)=percent {node.set_numeric_value(f64::from(percent));node.set_min_numeric_value(0.);node.set_max_numeric_value(100.);}
                    })}>
                    {gpui::canvas(|_,_,_|{},move|bounds,_,window,_| {
                        if let Some(track)=arc(bounds,0.,1.) {window.paint_path(track,accent.opacity(0.18));}
                        if let Some(fill)=arc(bounds,offset,fraction) {window.paint_path(fill,accent);}
                    }).size_full()}
                    <div class="absolute bottom-0 w-[32px] h-3 text-center text-[8px] leading-[12px] font-medium">{text}</div>
                </div>
            }.into_any_element()
        } else {
            rake::view!{<Icon size={IconSize::Navigation} {..Icon::new("sync-icon",if failed{IconName::Alert}else if complete{IconName::Check}else if outgoing>0{IconName::ArrowUp}else{IconName::Refresh})}/>}.into_any_element()
        };

        let owner = self.state.clone();

        rake::view! {
            <Tooltip {..Tooltip::new("sync-tip",label.clone())}>
                <button id="rail-sync" disabled={disabled} aria-label={label.clone()}
                    aria-description="Open explicit Fetch, Pull and Push actions. Counts reflect the last fetch. Publishing requires confirmation."
                    class="relative size-[32px] flex items-center justify-center rounded-[6px] border-1 focus-visible:border-focus-ring text-muted-ink"
                    style={|s|s.border_color(gpui::transparent_black()).when(failed,|s|s.text_color(theme.danger)).hover(|s|s.bg(theme.hairline)).debug_selector(||"rail-sync".into())}
                    on:click={move|_,window,cx|if let Some(source)=&source{owner.update(cx,|owner,cx|owner.open(source.clone(),window,cx));}}>
                    {progress}
                    if pending.is_none()&&incoming>0 {<div class="absolute -right-1 -top-1 rounded-[2px] px-0.5 text-[8px] bg-surface">{format!("↓ {}",if incoming>99{"99+".into()}else{incoming.to_string()})}</div>}
                    if pending.is_none()&&outgoing>0 {<div class="absolute -right-1 -bottom-1 rounded-[2px] px-0.5 text-[8px] bg-surface">{format!("↑ {}",if outgoing>99{"99+".into()}else{outgoing.to_string()})}</div>}
                </button>
            </Tooltip>
        }.into_any_element()
    }
}
