//! Measure anchors before GPUI's deferred overlay pass; keep popup layout out of normal flow.
use rake::gpui::{self, prelude::*};
use std::{cell::Cell, rc::Rc};

/// Shared visible bounds of a measured overlay trigger.
pub type AnchorBounds = Rc<Cell<Option<gpui::Bounds<gpui::Pixels>>>>;

/// Measure a trigger during prepaint without changing its layout or input behavior.
pub fn track(inner: impl IntoElement, bounds: AnchorBounds) -> impl IntoElement {
    Tracked {
        inner: inner.into_any_element(),
        bounds,
    }
}

struct Tracked {
    inner: gpui::AnyElement,
    bounds: AnchorBounds,
}

impl IntoElement for Tracked {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for Tracked {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        w: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, ()) {
        (self.inner.request_layout(w, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        w: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        let visible = bounds
            .intersect(&w.content_mask().bounds)
            .intersect(&gpui::Bounds::new(Default::default(), w.viewport_size()));

        self.bounds.set(
            (visible.size.width > gpui::px(0.) && visible.size.height > gpui::px(0.))
                .then_some(visible),
        );
        self.inner.prepaint(w, cx);
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        _: &mut (),
        w: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        self.inner.paint(w, cx);
    }
}

type BuildLayer = Box<
    dyn FnOnce(
        Option<gpui::Bounds<gpui::Pixels>>,
        &mut gpui::Window,
        &mut gpui::App,
    ) -> gpui::AnyElement,
>;

/// Build after the trigger has been measured, outside any ancestor's scroll clip.
pub(crate) fn floating(
    bounds: AnchorBounds,
    build: impl FnOnce(
        Option<gpui::Bounds<gpui::Pixels>>,
        &mut gpui::Window,
        &mut gpui::App,
    ) -> gpui::AnyElement
    + 'static,
) -> impl IntoElement {
    gpui::deferred(Floating {
        bounds,
        build: Some(Box::new(build)),
        painted: None,
    })
    .with_priority(1)
}

struct Floating {
    bounds: AnchorBounds,
    build: Option<BuildLayer>,
    painted: Option<gpui::AnyElement>,
}

impl IntoElement for Floating {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for Floating {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        w: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, ()) {
        (
            w.request_layout(
                gpui::Style {
                    position: gpui::Position::Absolute,
                    ..Default::default()
                },
                [],
                cx,
            ),
            (),
        )
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        w: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        if let Some(build) = self.build.take() {
            let viewport = w.viewport_size();
            let mut layer = build(self.bounds.get(), w, cx);

            layer.prepaint_as_root(
                Default::default(),
                gpui::size(
                    gpui::AvailableSpace::Definite(viewport.width),
                    gpui::AvailableSpace::Definite(viewport.height),
                ),
                w,
                cx,
            );
            self.painted = Some(layer);
        }
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        _: &mut (),
        w: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        if let Some(layer) = &mut self.painted {
            layer.paint(w, cx);
        }
    }
}
