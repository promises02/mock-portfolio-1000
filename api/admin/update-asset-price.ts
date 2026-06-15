/** Vercel serverless — POST /api/admin/update-asset-price */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  updateAdminAssetPriceWithAdminSdk,
  verifyAdminPassword,
} from '../../server/updateAdminAssetPriceAdmin';
import { getAdminFirestoreDb } from '../../server/firebaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { password, asset, newPrice, reason } = req.body ?? {};

  if (!verifyAdminPassword(password)) {
    return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
  }

  try {
    if (!getAdminFirestoreDb()) {
      return res.status(503).json({
        success: false,
        message:
          'Firebase Admin이 설정되지 않았습니다. Vercel 프로젝트 설정 → Environment Variables → FIREBASE_SERVICE_ACCOUNT에 서비스 계정 JSON을 추가한 뒤 재배포해주세요.',
      });
    }

    const result = await updateAdminAssetPriceWithAdminSdk(asset, Number(newPrice), reason);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error('[api/admin/update-asset-price] failed:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.',
    });
  }
}
