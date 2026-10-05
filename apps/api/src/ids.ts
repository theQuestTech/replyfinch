import { ulid } from 'ulid';

// Prefixed ULIDs: time-sortable, globally unique, safe to generate on any server
// or shard without coordination (see docs/PLAN.md "Scaling decisions").
export const newId = {
  account: () => `acc_${ulid()}`,
  user: () => `usr_${ulid()}`,
  visitor: () => `vis_${ulid()}`,
  conversation: () => `cnv_${ulid()}`,
  message: () => `msg_${ulid()}`,
  pageView: () => `pv_${ulid()}`,
};
