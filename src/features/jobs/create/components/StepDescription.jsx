// 第4弾: 作業の説明のみ。写真・動画は専用のページIDへ移動する。
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";

export function StepDescription({ jobDescription, setJobDescription }) {
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>作業の内容を伝えましょう</h2>
    <p className="f-sans" style={lfStyles.subtitle}>どんな作業をするか、初めての方にも分かるように書いてください（任意）。</p>
    <LFWizCard>
      <textarea aria-label="作業の説明" value={jobDescription} onChange={e => setJobDescription(e.target.value)}
        placeholder="例：ブロッコリーの収穫と箱詰めをお願いします。初めての方にも作業を説明します。"
        maxLength={1000} style={{background:"#fff",color:"#222",width:"100%",minHeight:200,padding:16,fontSize:16,lineHeight:1.8,border:"1px solid #E5E5E5",borderRadius:14,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}} />
      <p className="f-sans" style={{fontSize:13,color:"#717171",marginTop:8,textAlign:"right"}}>{jobDescription.length} / 1000</p>
    </LFWizCard>
  </>);
}
