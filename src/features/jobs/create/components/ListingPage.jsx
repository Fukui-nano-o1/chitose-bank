import { listingFrameState } from "../flowSteps.js";

// 既存の掲載本文を包む共通枠。入力state・保存・通信は持たない。
// 第1弾ではDOM階層、既存CSS、働き手側の寸法を変えない。
export function ListingPage({ step, pageId, isFarmer = true, embedded = false, stepAnim = "", onAnimationEnd, children }) {
  const frame = listingFrameState(pageId ?? step);
  const workerWide = step === 12 || step === 0 || step === 6;
  return (
    <div data-step={step} data-step-id={isFarmer ? frame.id || undefined : undefined}
      className={isFarmer ? `listing-page${frame.wide ? " listing-page-wide" : ""} listing-motion` : (stepAnim || "fade-in")}
      onAnimationEnd={onAnimationEnd}
      style={isFarmer ? undefined : {
        maxWidth: workerWide ? 1280 : 480, margin: "0 auto",
        padding: embedded ? (step > 0 ? "16px 20px 24px" : "0 20px 24px")
          : step > 0 ? "calc(64px + env(safe-area-inset-top, 0px)) 20px calc(76px + env(safe-area-inset-bottom, 0px))"
          : "calc(56px + env(safe-area-inset-top, 0px)) 20px 40px",
      }}>
      {children}
    </div>
  );
}
