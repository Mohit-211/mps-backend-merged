import * as os from 'os';
import * as process from 'process';
import { IProcessInfoResponse, IResourceUsageResponse, IServerTimeResponse, ISystemInfoResponse } from '../../types/SystemStatus';
import { ApiError, catchAsync, responseWrapper } from '../../utils';
import httpStatus from 'http-status';

export const getSystemInfo = catchAsync(async (req, res) => {
	try {
		const result: ISystemInfoResponse = {
			cpus: os.cpus(),
			network: os.networkInterfaces(),
			os: {
				platform: process.platform,
				version: os.release(),
				totalMemory: os.totalmem(),
				uptime: os.uptime(),
			},
			currentUser: os.userInfo(),
		};
		return responseWrapper(res, result, 'Successfully Fetched System Data');
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const getServerTime = catchAsync(async (req, res) => {
	try {
        const now: Date = new Date();
        const utc: Date = new Date(
            now.getTime() + now.getTimezoneOffset() * 60000,
        );
        const result: IServerTimeResponse = {
            utc,
            date: now,
        };
		return responseWrapper(res, result, 'Successfully Fetched Server Time');
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const getResourceUsage = catchAsync(async (req, res) => {
	try {
        const totalMem: number = os.totalmem();
        const memProc: NodeJS.MemoryUsage = process.memoryUsage();
        const freemMem: number = os.freemem();

        const result: IResourceUsageResponse = {
            processMemory: memProc,
            systemMemory: {
                free: freemMem,
                total: totalMem,
                percentFree: Math.round((freemMem / totalMem) * 100),
            },
            processCpu: process.cpuUsage(),
            systemCpu: os.cpus(),
        };
		return responseWrapper(res, result, 'Successfully Fetched Resource Usages Details');
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const getProcessInfo = catchAsync(async (req, res) => {
	try {
        const result: IProcessInfoResponse = {
            procCpu: process.cpuUsage(),
            memUsage: process.memoryUsage(),
            // env: process.env,
            pid: process.pid,
            uptime: process.uptime(),
            applicationVersion: process.version,
            nodeDependencyVersions: process.versions,
        };
		return responseWrapper(res, result, 'Successfully Fetched Processor Info');
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});
