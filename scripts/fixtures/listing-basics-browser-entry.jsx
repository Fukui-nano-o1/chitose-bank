// 実際の掲載フローをテスト用通信先で描く。CSSも本体と同じものを使用する。
import { CSS } from '../../src/appStyles';
import '../../src/index.css';
import './offline/entry.jsx';
const style = document.createElement('style');
style.textContent = CSS;
document.head.append(style);
