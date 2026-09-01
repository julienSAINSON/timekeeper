export function calculateSlotReductions({
  slots,
  completedSlotIndex,
  totalDebtMs,
  unallocatedDurationMs,
  strategy,
  slotReductionsMs = {},
}) {
  const reductions = { ...slotReductionsMs };
  if (strategy === "shift-end") {
    return reductions;
  }

  const targetReductionMs = Math.max(0, totalDebtMs - unallocatedDurationMs);
  const appliedReductionMs = Object.values(reductions).reduce(
    (total, reduction) => total + Number(reduction || 0),
    0,
  );
  let remainingReductionMs = Math.max(0, targetReductionMs - appliedReductionMs);
  let candidates = slots.slice(completedSlotIndex + 1);
  const availableReduction = (slot) => Math.max(
    0,
    Number(slot.durationMinutes) * 60 * 1000 - Number(reductions[slot.id] || 0) - 1000,
  );

  if (strategy === "last") {
    candidates = candidates.reverse();
  }

  if (strategy === "proportional") {
    const availableMs = candidates.reduce((total, slot) => total + availableReduction(slot), 0);
    if (availableMs === 0) {
      return reductions;
    }
    let allocatedReductionMs = 0;
    candidates.forEach((slot, index) => {
      const reduction = Math.min(
        availableReduction(slot),
        index === candidates.length - 1
          ? Math.max(0, remainingReductionMs - allocatedReductionMs)
          : Math.round((remainingReductionMs * availableReduction(slot)) / availableMs),
      );
      reductions[slot.id] = Number(reductions[slot.id] || 0) + reduction;
      allocatedReductionMs += reduction;
    });
    return reductions;
  }

  candidates.forEach((slot) => {
    const reduction = Math.min(availableReduction(slot), remainingReductionMs);
    reductions[slot.id] = Number(reductions[slot.id] || 0) + reduction;
    remainingReductionMs -= reduction;
  });
  return reductions;
}