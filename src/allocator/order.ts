// Service-ordering test surface — this module exists to satisfy structure:check
// which requires a source file at this location for __tests__/order.test.ts.
// The test exercises orderServicesForAllocation() from allocate.ts in
// isolation, verifying that scattered grouped services are made contiguous and
// that group first-occurrence order is preserved. No additional runtime exports
// are provided here; the test imports directly from allocate.ts.
