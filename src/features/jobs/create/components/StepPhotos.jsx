// 農家 step7: 写真（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// ★中身は移設前と同一（行頭の字下げだけを詰めた）。表示・保存の仕様は変えていない。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { lfStyles } from "../lfStyles";
import { LFWizCard, Dots } from "../../../../components/ui";
import { photoThumb } from "../../../../lib/utils";
import { uploadPhoto } from "../jobCreateApi";

export function StepPhotos({ jobPhotos, setJobPhotos, photoUploading, setPhotoUploading }) {
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>写真</h2>
    <p className="f-sans" style={lfStyles.subtitle}>写真は最大10枚。1枚目が求人の顔になります。畑や作業の様子が伝わると応募が増えます。</p>
    <LFWizCard>
          {/* アップロードボタン（multiple・残り枠まで直列処理） */}
          <div style={{ marginBottom: jobPhotos.length > 0 ? 16 : 0 }}>
            <label className="f-sans btn-primary" style={{ display:"inline-block", padding:"12px 24px", fontSize:14, fontWeight:700, cursor: photoUploading ? "wait" : "pointer", opacity: (photoUploading || jobPhotos.length >= 10) ? 0.5 : 1 }}>
              {photoUploading ? <>アップロード中<Dots /></> : "＋ 写真を追加"}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading || jobPhotos.length >= 10} onChange={async e => {
                const files = Array.from(e.target.files || []);
                if (files.length === 0) return;
                const room = 10 - jobPhotos.length;
                const queue = files.slice(0, room);
                setPhotoUploading(true);
                // 全ファイルを並列アップロード（各ファイル内も原寸＋サムネを並列・デコード1回）
                const results = await Promise.all(queue.map(file =>
                  uploadPhoto(file).catch(err => { console.error('photo upload failed', file.name, err); return null; })
                ));
                const uploaded = results.filter(r => r && r.url).map(r => ({ caption: "", ...r }));
                if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
                if (uploaded.length < queue.length) {
                  alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
                }
                setPhotoUploading(false);
                e.target.value = '';
              }} />
            </label>
            <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8 }}>{jobPhotos.length} / 10 枚</p>
          </div>

          {/* 空状態：大タップゾーン */}
          {jobPhotos.length === 0 && (
            <label className="f-sans" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"48px 24px", border:"2px dashed #D8D8D8", borderRadius:16, cursor: photoUploading ? "wait" : "pointer", background:"#FAFAFA", textAlign:"center" }}>
              <span style={{ fontSize:44, lineHeight:1 }}>📷</span>
              <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>写真をドロップ、またはタップして追加</span>
              <span className="f-sans" style={{ fontSize:14, color:"#B0B0B0", maxWidth:280, lineHeight:1.6 }}>畑の全景・作業の様子・収穫物が伝わる写真ほど、応募が増えます。1枚目がカバー写真になります。</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading} onChange={async e => {
                const files = Array.from(e.target.files || []);
                if (files.length === 0) return;
                const queue = files.slice(0, 10);
                setPhotoUploading(true);
                // 全ファイルを並列アップロード（各ファイル内も原寸＋サムネを並列・デコード1回）
                const results = await Promise.all(queue.map(file =>
                  uploadPhoto(file).catch(err => { console.error('photo upload failed', file.name, err); return null; })
                ));
                const uploaded = results.filter(r => r && r.url).map(r => ({ caption: "", ...r }));
                if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
                if (uploaded.length < queue.length) {
                  alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
                }
                setPhotoUploading(false);
                e.target.value = '';
              }} />
            </label>
          )}

          {/* 追加後：カバー大・以降小グリッド */}
          {jobPhotos.length > 0 && (
            <div>
              <div style={{ position:"relative", marginBottom:10 }}>
                <img loading="lazy" src={photoThumb(jobPhotos[0])} alt="カバー写真" style={{ width:"100%", height:260, objectFit:"cover", borderRadius:14, border:"1px solid #EEE" }} />
                <span className="f-sans" style={{ position:"absolute", top:10, left:10, padding:"4px 12px", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, fontWeight:700, borderRadius:8 }}>カバー</span>
                <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== 0))} style={{ position:"absolute", top:8, right:8, width:28, height:28, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:15, cursor:"pointer", lineHeight:1 }}>×</button>
              </div>
              {/* 2枚目以降は2列の大サイズ（2026-07-16）。justifyContent:centerで奇数枚の最後の1枚＝空白が中央に来る */}
              {jobPhotos.length > 1 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                  {jobPhotos.slice(1).map((p, i) => {
                    const idx = i + 1;
                    return (
                      <div key={idx} style={{ position:"relative", width:"calc(50% - 4px)" }}>
                        <img loading="lazy" src={photoThumb(p)} alt={`写真${idx+1}`} style={{ width:"100%", aspectRatio:"4 / 3", objectFit:"cover", borderRadius:10, border:"1px solid #EEE", display:"block" }} />
                        <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== idx))} style={{ position:"absolute", top:-6, right:-6, width:22, height:22, borderRadius:"50%", border:"none", background:"#222", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </LFWizCard>
  </>);
}
