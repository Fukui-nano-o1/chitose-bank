import { lazyChunk } from "./chunkReload";
import { createIdleQueue } from "../lib/idleQueue";

export const ChatView = lazyChunk(() => import("../components/ChatView").then(m => ({ default: m.ChatView })));
export const AdminChatPage = lazyChunk(() => import("../components/AdminChat").then(m => ({ default: m.AdminChatPage })));
export const ApplyPending = lazyChunk(() => import("../components/ApplyPending").then(m => ({ default: m.ApplyPending })));
export const NewApplicantsPage = lazyChunk(() => import("../components/NewApplicantsPage").then(m => ({ default: m.NewApplicantsPage })));
export const LandingFlow = lazyChunk(() => import("../features/jobs/create/LandingFlow").then(m => ({ default: m.LandingFlow })));
export const AdminTab = lazyChunk(() => import("../components/admin/AdminTab").then(m => ({ default: m.AdminTab })));
export const ConsignmentRoom = lazyChunk(() => import("../features/consignment/ConsignmentRoom").then(m => ({ default: m.ConsignmentRoom })));
export const AdminBoxRegistryPage = lazyChunk(() => import("../components/admin/AdminBoxRegistryPage").then(m => ({ default: m.AdminBoxRegistryPage })));
export const AdminWorkingRoom = lazyChunk(() => import("../components/admin/AdminWorkingRoom").then(m => ({ default: m.AdminWorkingRoom })));
export const AdminUpcomingRoom = lazyChunk(() => import("../components/admin/AdminUpcomingRoom").then(m => ({ default: m.AdminUpcomingRoom })));
export const AdminEvaluationRoom = lazyChunk(() => import("../components/admin/AdminEvaluationRoom").then(m => ({ default: m.AdminEvaluationRoom })));
export const AdminSystemRoom = lazyChunk(() => import("../components/admin/AdminSystemRoom").then(m => ({ default: m.AdminSystemRoom })));
export const AdminReviewCommentsRoom = lazyChunk(() => import("../components/admin/AdminReviewCommentsRoom").then(m => ({ default: m.AdminReviewCommentsRoom })));
export const AdminReportsRoom = lazyChunk(() => import("../components/admin/AdminReportsRoom").then(m => ({ default: m.AdminReportsRoom })));
export const AdminFarmerPagesRoom = lazyChunk(() => import("../components/admin/AdminFarmerPagesRoom").then(m => ({ default: m.AdminFarmerPagesRoom })));
export const AdminAnimationsRoom = lazyChunk(() => import("../components/admin/AdminAnimationsRoom").then(m => ({ default: m.AdminAnimationsRoom })));
export const FarmTimelessRoom = lazyChunk(() => import("../components/admin/FarmTimelessRoom").then(m => ({ default: m.FarmTimelessRoom })));
export const ProfileHub = lazyChunk(() => import("../components/ProfileHub").then(m => ({ default: m.ProfileHub })));
export const TodayPage = lazyChunk(() => import("../components/TodayPage").then(m => ({ default: m.TodayPage })));
export const SavedJobsView = lazyChunk(() => import("../components/SavedJobsView").then(m => ({ default: m.SavedJobsView })));
export const ChatList = lazyChunk(() => import("../components/ChatList").then(m => ({ default: m.ChatList })));
export const LoginScreen = lazyChunk(() => import("../components/LoginScreen").then(m => ({ default: m.LoginScreen })));
export const AccountHolderForm = lazyChunk(() => import("../components/AccountHolderForm").then(m => ({ default: m.AccountHolderForm })));
export const ProfileModal = lazyChunk(() => import("../components/ProfileModal").then(m => ({ default: m.ProfileModal })));
export const OnboardingModal = lazyChunk(() => import("../components/OnboardingModal").then(m => ({ default: m.OnboardingModal })));
export const JobSearchMapView = lazyChunk(() => import("../components/JobSearchMapView").then(m => ({ default: m.JobSearchMapView })));
export const WorkerExperiencePage = lazyChunk(() => import("../components/WorkerExperiencePage").then(m => ({ default: m.WorkerExperiencePage })));
export const HelpCenter = lazyChunk(() => import("../app/help/HelpCenter").then(m => ({ default: m.HelpCenter })));
export const InstallGuide = lazyChunk(() => import("../app/help/HelpCenter").then(m => ({ default: m.InstallGuide })));
export const InsurancePrepPage = lazyChunk(() => import("../components/VisitAndInsurance").then(m => ({ default: m.InsurancePrepPage })));
export const VisitEntrance = lazyChunk(() => import("../components/VisitAndInsurance").then(m => ({ default: m.VisitEntrance })));
export const VisitorQRPage = lazyChunk(() => import("../components/VisitAndInsurance").then(m => ({ default: m.VisitorQRPage })));

export const CharterPage = lazyChunk(() => import("./legal/LegalPages").then(m => ({ default: m.CharterPage })));
export const PrivacyPage = lazyChunk(() => import("./legal/LegalPages").then(m => ({ default: m.PrivacyPage })));
export const TermsPage = lazyChunk(() => import("./legal/LegalPages").then(m => ({ default: m.TermsPage })));
export const Terms = lazyChunk(() => import("../Terms"));
export const PrivacyPolicy = lazyChunk(() => import("./legal/PrivacyPolicy").then(m => ({ default: m.PrivacyPolicy })));
export const DataConstitution = lazyChunk(() => import("./legal/DataConstitution").then(m => ({ default: m.DataConstitution })));

const pages = {
  charter: CharterPage, privacy: PrivacyPage, terms: TermsPage,
  search: JobSearchMapView, saved: SavedJobsView, chats: ChatList, profile: ProfileHub,
  calendar: TodayPage, login: LoginScreen, account: AccountHolderForm,
  help: HelpCenter, install: InstallGuide, visit: VisitEntrance, qr: VisitorQRPage,
  insurance: InsurancePrepPage, experience: WorkerExperiencePage,
  "new-applicants": NewApplicantsPage, boxes: AdminBoxRegistryPage,
};
const adminPages = {
  consignment: ConsignmentRoom, working: AdminWorkingRoom, upcoming: AdminUpcomingRoom,
  evaluation: AdminEvaluationRoom, system: AdminSystemRoom, animations: AdminAnimationsRoom,
  "review-comments": AdminReviewCommentsRoom, reports: AdminReportsRoom,
  "farmer-pages": AdminFarmerPagesRoom, timeless: FarmTimelessRoom,
};

// 行き先の決定・アクセス制御はAppが正。ここはコードだけの先読みで、通信や権限判定をしない。
export function pageForRoute(hash) {
  const [page, sub] = String(hash || "search").replace(/^#?\/?/, "").split("/");
  if (page === "chat") return sub === "admin" ? AdminChatPage : ChatView;
  if (page === "work") return sub === "new" || sub === "edit" ? LandingFlow : JobSearchMapView;
  if (page === "apply") return sub === "pending" ? ApplyPending : null;
  if (page === "admin") return Object.hasOwn(adminPages, sub) ? adminPages[sub] : AdminTab;
  return Object.hasOwn(pages, page) ? pages[page] : null;
}

export function preloadRoute(hash) {
  return pageForRoute(hash)?.preload() || Promise.resolve();
}

function canSpeculate() {
  const connection = navigator.connection;
  return navigator.onLine !== false && !connection?.saveData &&
    !["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
}

// 起動した画面を先に仕上げてから、共通ナビを1本ずつ温める。低速回線・省データ時は行わない。
export function warmNavigation(signedIn) {
  const queue = createIdleQueue();
  let cancelled = false;
  preloadRoute(window.location.hash).then(() => {
    if (cancelled || !canSpeculate()) return;
    for (const hash of signedIn ? ["search", "saved", "chats", "profile"] : ["search", "login"]) {
      queue.push(() => {
        if (!canSpeculate() || document.visibilityState === "hidden") return;
        return preloadRoute(hash);
      });
    }
  });
  return () => { cancelled = true; queue.cancel(); };
}

export function installRoutePreloading() {
  const onRoute = () => { void preloadRoute(window.location.hash); };
  const onIntent = event => {
    if (!canSpeculate()) return;
    const target = event.target?.closest?.('[data-prefetch-route], a[href^="#/"]');
    const hash = target?.getAttribute("data-prefetch-route") || target?.getAttribute("href");
    if (hash) void preloadRoute(hash);
  };
  onRoute(); // Reactの描画・認証復元と並行して、直リンク／前回の画面のコードを取得する。
  window.addEventListener("hashchange", onRoute);
  for (const name of ["pointerover", "pointerdown", "focusin"]) document.addEventListener(name, onIntent, { passive:true });
  return () => {
    window.removeEventListener("hashchange", onRoute);
    for (const name of ["pointerover", "pointerdown", "focusin"]) document.removeEventListener(name, onIntent);
  };
}
