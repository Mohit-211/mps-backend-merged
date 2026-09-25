import userAuthRoute from './userAuth.route';
import userOperationRoute from './userOperations.route';

const userRoutes = [
	{
		path: '/user/auth/',
		route: userAuthRoute,
	},
	{
        path: '/user/',
        route: userOperationRoute,
    }
];

export default userRoutes;
