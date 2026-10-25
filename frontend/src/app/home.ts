// MyTasker — where a signed-in person lands.
// The app is deliberately projects-first: the home experience is the project list → project detail.
// Other modules (tasks, prompts, routine, insights…) are still fully available, just de-emphasised in
// navigation. Change this one constant to move the primary home elsewhere.

/** Primary home route for an authenticated owner. `/projects` resolves to the project catalog. */
export const HOME_ROUTE = '/projects';
