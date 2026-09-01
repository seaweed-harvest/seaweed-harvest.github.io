export function calculateContractWorkAmount(loadings, unloadings) {
  const loadingCount = nonNegativeInteger(loadings);
  const unloadingCount = nonNegativeInteger(unloadings);
  const totalActivityCount = loadingCount + unloadingCount;
  const qualifies = loadingCount >= 8 || unloadingCount >= 8;
  return {
    loadingCount,
    unloadingCount,
    totalActivityCount,
    qualifies,
    contractAmountKes: qualifies
      ? 500 + Math.max(totalActivityCount - 8, 0) * 25
      : null,
    referenceAmountKes: totalActivityCount * 25
  };
}

export function calculateSelectedPayment(days, availablePhoneCredit = 0) {
  const rows = Array.isArray(days) ? days : [];
  const workAmount = rows.reduce(
    (sum, day) => sum + nonNegativeInteger(day?.approved_work_amount_kes),
    0
  );
  const phoneDataAmount = rows.reduce(
    (sum, day) => sum + nonNegativeInteger(day?.phone_data_allowance_kes),
    0
  );
  const phoneDataCreditApplied = Math.min(
    phoneDataAmount,
    nonNegativeInteger(availablePhoneCredit)
  );
  return {
    dayCount: rows.length,
    workAmount,
    phoneDataAmount,
    phoneDataCreditApplied,
    transferAmount: workAmount + phoneDataAmount - phoneDataCreditApplied
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}
