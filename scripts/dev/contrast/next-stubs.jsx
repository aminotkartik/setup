/* Only the isolated component gallery uses these. Real-route validation uses
 * Next's real router. No gallery interaction is allowed to navigate or mutate. */
import React from 'react';
export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }
export default function AuditLink({ children, ...props }) { return <a {...props}>{children}</a>; }
