//! Frame reconciliation keeps focus guards and accessibility in sync with painted modals.
use super::{DialogHostState, DialogState};
use rake::gpui::{self, prelude::*};

pub(super) enum Hook {
    Host(DialogHostState),
    Background(bool),
    Surface(gpui::Entity<DialogState>),
}

pub(super) struct Frame<E> {
    pub inner: E,
    pub hook: Hook,
}

impl<E: gpui::Element> IntoElement for Frame<E> {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl<E: gpui::Element> gpui::Element for Frame<E> {
    type RequestLayoutState = <E as gpui::Element>::RequestLayoutState;
    type PrepaintState = <E as gpui::Element>::PrepaintState;

    fn id(&self) -> Option<gpui::ElementId> {
        gpui::Element::id(&self.inner)
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        self.inner.source_location()
    }

    fn a11y_role(&self) -> Option<gpui::accesskit::Role> {
        self.inner.a11y_role()
    }

    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        self.inner.write_a11y_info(node);

        if matches!(self.hook, Hook::Background(true)) {
            node.set_hidden();
        }
    }

    fn a11y_synthetic_children(
        &mut self,
        prepaint: &mut Self::PrepaintState,
        builder: &mut gpui::A11ySubtreeBuilder,
    ) {
        gpui::Element::a11y_synthetic_children(&mut self.inner, prepaint, builder);
    }

    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, Self::RequestLayoutState) {
        self.inner.request_layout(id, inspector, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        state: &mut Self::RequestLayoutState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> Self::PrepaintState {
        if let Hook::Host(host) = &self.hook {
            host.begin_frame(window);
        }

        let painted = self
            .inner
            .prepaint(id, inspector, bounds, state, window, cx);

        match &self.hook {
            Hook::Host(host) => {
                let host = host.clone();
                let handle = window.window_handle();

                cx.defer(move |cx| {
                    let _ = handle.update(cx, |_, window, cx| host.audit(window, cx));
                });
            }
            Hook::Surface(state) => state.update(cx, |state, _| {
                state.mounted(bounds);
            }),
            Hook::Background(_) => {}
        }

        painted
    }

    fn paint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        state: &mut Self::RequestLayoutState,
        painted: &mut Self::PrepaintState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        self.inner
            .paint(id, inspector, bounds, state, painted, window, cx);
    }
}
