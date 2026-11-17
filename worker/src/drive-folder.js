const FOLDER_ERRORS = {
  wrongAccount: 'The folder script must run as the Saujana Bali account that owns the scans folder.',
  wrongRoot: 'The folder script could not access the configured scans folder.',
  conflictingFolder: 'A folder with this order number already exists today. Check the order and use the correct folder link.',
  sharingFailed: 'The order folder exists, but link sharing could not be enabled. Check sharing in Drive before sending it.',
  busy: 'Drive folder creation is busy. Please try again.'
};
const labAccount = 'saujanalab.bali@gmail.com';
const driveId = /^[A-Za-z0-9_-]{12,}$/;

export async function labDriveFolder(env, data, check = false, request = fetch) {
  const secret = String(env.LAB_DRIVE_FOLDER_SECRET || '');
  const rootId = String(env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '');
  const endpoint = String(env.LAB_DRIVE_FOLDER_URL || '');
  if (secret.length < 32 || !driveId.test(rootId) || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    throw Error('Lab Drive folder creation has not been connected.');
  }
  const orderNumber = String(data.orderNumber || '').trim().toUpperCase();
  const customerName = String(data.customerName || '').trim();
  if (!check && (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(orderNumber) || customerName.length > 120 || /[\x00-\x1f\x7f]/.test(customerName))) {
    throw Error('Check the order number and customer name before creating the Drive folder.');
  }
  let result;
  try {
    const signal = AbortSignal.timeout(25000);
    let response = await request(endpoint, {
      method: 'POST', redirect: 'manual', signal,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret, rootId, action: check ? 'check' : 'create', ...(check ? {} : {orderNumber, customerName})})
    });
    if ([302, 303].includes(response.status)) {
      const output = new URL(response.headers.get('Location'));
      if (output.origin !== 'https://script.googleusercontent.com' || output.pathname !== '/macros/echo' || output.username || output.password) throw Error('Unexpected redirect');
      response = await request(output.href, {method: 'GET', redirect: 'manual', signal});
    }
    if (!response.ok) throw Error('Unexpected response');
    result = await response.json();
  } catch {
    throw Error('Could not reach the lab folder script. Try again or paste an existing Drive folder link.');
  }
  if (result?.success !== true) {
    throw Error(Object.hasOwn(FOLDER_ERRORS, result?.code) ? FOLDER_ERRORS[result.code] : 'The lab folder script is not ready. Check its setup or paste an existing Drive folder link.');
  }
  if (result.account !== labAccount || result.rootId !== rootId) throw Error('The folder script did not verify the lab account and scans folder.');
  if (check) return {success: true, labAccountVerified: true};
  if (typeof result.folderId !== 'string' || !driveId.test(result.folderId) || result.folderName !== (customerName ? orderNumber + ' ' + customerName : orderNumber)) {
    throw Error('The lab folder script returned an unexpected folder.');
  }
  return {folderId: result.folderId, folderName: result.folderName, folderUrl: 'https://drive.google.com/drive/folders/' + result.folderId};
}
