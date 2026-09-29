import { goAlongPath } from './routeTrail.js';

export const laborNoticePath = (role, applicationId) =>
  `/profile/${role === 'farmer' ? 'employer' : 'worker'}/notice/${applicationId}`;

export function readLaborNoticeRoute(hash) {
  const match = String(hash || '').replace(/^#?\/?/, '')
    .match(/^profile\/(employer|worker)\/notice\/([a-z0-9-]+)$/i);
  return match ? { role: match[1] === 'employer' ? 'farmer' : 'worker', applicationId: match[2] } : null;
}

export function openLaborNotice(role, applicationId, label = '応募一覧に戻る') {
  goAlongPath(laborNoticePath(role, applicationId), label);
}
