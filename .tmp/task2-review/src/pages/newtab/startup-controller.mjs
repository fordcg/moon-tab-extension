export const createStartupController = ({ elements, callbacks, config }) => {
  const { searchInput, searchFrame, searchOutline, searchOutlineRect } = elements;
  const { focusSearchInputIfIdle } = callbacks;
  const {
    searchTraceDuration,
    placeholderFadeDuration,
    moduleRevealDelay,
    searchOutlineStrokeWidth,
    searchOutlineInset,
  } = config;

  const applySearchReadyState = () => {
    if (searchInput instanceof HTMLInputElement) {
      searchInput.disabled = false;
      searchInput.removeAttribute("aria-disabled");
    }

    document.body.classList.add("is-search-ready");
    window.requestAnimationFrame(() => {
      focusSearchInputIfIdle();
    });
  };

  const applyReadyState = () => {
    window.setTimeout(() => {
      document.body.classList.add("is-ready");
    }, placeholderFadeDuration + moduleRevealDelay);
  };

  const applyReducedMotionReadyState = () => {
    document.body.classList.add("is-ready");
  };

  const syncSearchOutline = () => {
    if (!(searchFrame instanceof HTMLElement) || !(searchOutline instanceof SVGSVGElement) || !(searchOutlineRect instanceof SVGRectElement)) {
      return 0;
    }

    const rect = searchFrame.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const strokeWidth = searchOutlineStrokeWidth;
    const inset = searchOutlineInset;
    const halfStroke = strokeWidth / 2;
    const frameStyles = window.getComputedStyle(searchFrame);
    const frameRadius = Number.parseFloat(frameStyles.borderTopLeftRadius) || 0;
    const x = inset + halfStroke;
    const y = inset + halfStroke;
    const outlineWidth = Math.max(1, width - inset * 2 - strokeWidth);
    const outlineHeight = Math.max(1, height - inset * 2 - strokeWidth);
    const radius = Math.max(0, frameRadius - inset - halfStroke);

    searchOutline.setAttribute("viewBox", `0 0 ${width} ${height}`);
    searchOutlineRect.style.strokeWidth = String(strokeWidth);
    searchOutlineRect.setAttribute("x", String(x));
    searchOutlineRect.setAttribute("y", String(y));
    searchOutlineRect.setAttribute("width", String(outlineWidth));
    searchOutlineRect.setAttribute("height", String(outlineHeight));
    searchOutlineRect.setAttribute("rx", String(radius));
    searchOutlineRect.setAttribute("ry", String(radius));

    const length = searchOutlineRect.getTotalLength();
    searchOutlineRect.style.strokeDasharray = `${length}`;
    searchOutlineRect.style.strokeDashoffset = `${length}`;
    return length;
  };

  const setOutlineComplete = () => {
    if (searchOutlineRect instanceof SVGRectElement) {
      searchOutlineRect.style.strokeDashoffset = "0";
    }
  };

  const playSearchTrace = () => {
    const length = syncSearchOutline();
    if (!length || !(searchOutlineRect instanceof SVGRectElement)) {
      applyReadyState();
      return;
    }

    const traceAnimation = searchOutlineRect.animate(
      [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
      {
        duration: searchTraceDuration,
        easing: "cubic-bezier(0.35, 0, 0.15, 1)",
      },
    );

    traceAnimation.finished
      .then(() => {
        setOutlineComplete();
        applyReadyState();
      })
      .catch(() => {
        setOutlineComplete();
        applyReadyState();
      });
  };

  const initialize = ({ prefersReducedMotion }) => {
    applySearchReadyState();

    if (prefersReducedMotion.matches) {
      syncSearchOutline();
      setOutlineComplete();
      applyReducedMotionReadyState();
      return;
    }

    window.requestAnimationFrame(playSearchTrace);
  };

  const handleResize = () => {
    const length = syncSearchOutline();
    if (document.body.classList.contains("is-search-ready") && length) {
      setOutlineComplete();
    }
  };

  return {
    initialize,
    handleResize,
  };
};
