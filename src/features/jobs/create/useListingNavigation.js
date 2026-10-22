import { useCallback, useEffect, useRef, useState } from "react";
import { legacyStepId } from "./flowSteps.js";
import { isListingPage, legacyNumberForPage, listingPageHash, parseListingRoute, resolveListingResume } from "./listingNavigation.js";

// 農家フローの画面IDとURLを一対一にする。働き手の番号・保存APIには触れない。
export function useListingNavigation({ farmer, initialStep = 0, initialForm, ready = true }) {
  const scope = useRef(parseListingRoute(window.location.hash)?.scope || null);
  const [state, setState] = useState(() => {
    if (!farmer) return { pageId: null, workerStep: initialStep, returnToConfirm: false };
    const route = parseListingRoute(window.location.hash);
    if (route?.invalid) return { error: "unknown_route", returnToConfirm: false };
    if (route?.pageId) return { pageId: route.pageId, returnToConfirm: route.returnToConfirm };
    return resolveListingResume(initialForm || {}, initialStep);
  });
  const current = useRef(state);
  current.current = state;
  const commit = useCallback(next => {
    current.current = next;
    setState(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const writeRoute = useCallback((pageId, returnToConfirm, replace) => {
    const route = parseListingRoute(window.location.hash);
    if (!farmer || !scope.current || route?.scope !== scope.current || route.auxiliary || route.invalid) return;
    const next = listingPageHash(scope.current, pageId, returnToConfirm);
    if (!next || window.location.hash === next) return;
    if (replace) window.history.replaceState(window.history.state, "", next);
    else window.location.hash = next;
  }, [farmer]);
  const setPage = useCallback((pageId, { replace = false, returnToConfirm = current.current.returnToConfirm } = {}) => {
    if (!isListingPage(pageId)) { commit({ ...current.current, error: "unknown_page" }); return; }
    const next = { pageId, returnToConfirm: !!returnToConfirm && !["intro", "review", "complete"].includes(pageId) };
    commit(next);
    writeRoute(next.pageId, next.returnToConfirm, replace);
  }, [commit, writeRoute]);
  const setStep = useCallback(value => {
    const previous = farmer ? legacyNumberForPage(current.current.pageId) : current.current.workerStep;
    const n = typeof value === "function" ? value(previous) : value;
    if (farmer) setPage(legacyStepId(n));
    else commit({ ...current.current, workerStep: n });
  }, [farmer, setPage, commit]);
  const setReturnToConfirm = useCallback(value => {
    const next = typeof value === "function" ? value(current.current.returnToConfirm) : value;
    commit({ ...current.current, returnToConfirm: !!next });
  }, [commit]);
  const restorePage = useCallback((form, fallbackStep) => {
    const route = parseListingRoute(window.location.hash);
    if (route?.scope === scope.current && route.invalid) { commit({ error: "unknown_route" }); return; }
    if (route?.scope === scope.current && route.pageId) {
      setPage(route.pageId, { replace: true, returnToConfirm: route.returnToConfirm });
      return;
    }
    const next = resolveListingResume(form, fallbackStep);
    if (next.error) commit(next);
    else setPage(next.pageId, { replace: true, returnToConfirm: next.returnToConfirm });
  }, [commit, setPage]);

  useEffect(() => {
    if (!farmer) return;
    const sync = () => {
      const route = parseListingRoute(window.location.hash);
      // 別の求人・別の端末下書きはAppのkeyで再マウントする。今の入力を流用しない。
      if (route?.scope !== scope.current) return;
      if (route.invalid) { commit({ ...current.current, error: "unknown_route" }); return; }
      if (route.pageId) commit({ pageId: route.pageId, returnToConfirm: route.auxiliary ? current.current.returnToConfirm : route.returnToConfirm });
      else if (route.scope === "work/new") commit({ pageId: "intro", returnToConfirm: false });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [farmer, commit]);
  useEffect(() => {
    if (farmer && ready && !current.current.error) writeRoute(current.current.pageId, current.current.returnToConfirm, true);
  }, [farmer, ready, writeRoute]);

  return {
    step: farmer ? legacyNumberForPage(state.pageId || legacyStepId(state.workerStep)) : state.workerStep,
    pageId: farmer ? state.pageId || legacyStepId(state.workerStep) : null,
    routeError: farmer ? state.error : null,
    returnToConfirm: !!state.returnToConfirm,
    setStep, setPage, setReturnToConfirm, restorePage,
  };
}
