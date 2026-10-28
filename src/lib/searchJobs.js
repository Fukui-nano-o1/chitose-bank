// Compatibility entry: the search feature owns the implementation and in-flight state.
// Remove after all callers import the feature directly and regression checks pass.
export * from "../features/jobs/search/searchJobs.js";
