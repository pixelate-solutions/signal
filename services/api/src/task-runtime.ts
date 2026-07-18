import { Client, Connection } from "@temporalio/client";

import type { Principal } from "@signal/auth-sdk";
import type { ActionResponseInput, DeviceCommandResult, Task } from "@signal/contracts";

import type { DemoTaskRuntime } from "./demo-runtime.js";

export interface TaskRuntime {
  ready(): Promise<boolean>;
  start(principal: Principal, task: Task): Promise<void>;
  respond(
    principal: Principal,
    task: Task,
    actionRequestId: string,
    response: ActionResponseInput,
  ): Promise<void>;
  control(task: Task, action: "pause" | "resume" | "cancel"): Promise<void>;
  instruct(task: Task, instruction: string): Promise<void>;
  emergencyStop(tasks: readonly Task[], reason: string): Promise<void>;
  deviceResult(task: Task, result: DeviceCommandResult): Promise<void>;
}

export class DemoTaskRuntimeAdapter implements TaskRuntime {
  public constructor(private readonly demo: DemoTaskRuntime) {}

  public async ready(): Promise<boolean> {
    return true;
  }

  public async start(principal: Principal, task: Task): Promise<void> {
    this.demo.start(principal, task);
  }

  public async respond(
    principal: Principal,
    task: Task,
    actionRequestId: string,
    response: ActionResponseInput,
  ): Promise<void> {
    this.demo.resume(principal, task.id, actionRequestId, response);
  }

  public control(_task: Task, _action: "pause" | "resume" | "cancel"): Promise<void> {
    return Promise.resolve();
  }

  public instruct(_task: Task, _instruction: string): Promise<void> {
    return Promise.resolve();
  }

  public emergencyStop(_tasks: readonly Task[], _reason: string): Promise<void> {
    return Promise.resolve();
  }

  public deviceResult(_task: Task, _result: DeviceCommandResult): Promise<void> {
    return Promise.resolve();
  }
}

export class TemporalTaskRuntime implements TaskRuntime {
  readonly #client: Client;

  private constructor(
    private readonly connection: Connection,
    namespace: string,
    private readonly taskQueue: string,
  ) {
    this.#client = new Client({ connection, namespace });
  }

  public async ready(): Promise<boolean> {
    try {
      await this.connection.workflowService.getSystemInfo({});
      return true;
    } catch {
      return false;
    }
  }

  public static async connect(input: {
    address: string;
    namespace: string;
    taskQueue: string;
    tls?: boolean;
    apiKey?: string;
  }): Promise<TemporalTaskRuntime> {
    const connection = await Connection.connect({
      address: input.address,
      tls: input.tls ?? false,
      ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    });
    return new TemporalTaskRuntime(connection, input.namespace, input.taskQueue);
  }

  public async start(principal: Principal, task: Task): Promise<void> {
    try {
      await this.#client.workflow.start("taskWorkflow", {
        taskQueue: this.taskQueue,
        workflowId: task.workflowId,
        args: [{ taskId: task.id, tenantId: principal.tenantId }],
        memo: {
          tenantId: principal.tenantId,
          taskId: task.id,
          ownerUserId: task.ownerUserId,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "WorkflowExecutionAlreadyStartedError") return;
      throw error;
    }
  }

  public async respond(
    _principal: Principal,
    task: Task,
    actionRequestId: string,
    response: ActionResponseInput,
  ): Promise<void> {
    await this.#client.workflow.getHandle(task.workflowId).signal("respondToActionRequest", {
      actionRequestId,
      response: response.response,
      materialDigest: response.materialDigest,
      ...(response.modifiedPayload === undefined
        ? {}
        : { modifiedPayload: response.modifiedPayload }),
      ...(response.authenticationProofHandle === undefined
        ? {}
        : { authenticationProofHandle: response.authenticationProofHandle }),
    });
  }

  public async control(task: Task, action: "pause" | "resume" | "cancel"): Promise<void> {
    await this.#client.workflow.getHandle(task.workflowId).signal(action);
  }

  public async instruct(task: Task, instruction: string): Promise<void> {
    await this.#client.workflow.getHandle(task.workflowId).signal("userInstruction", instruction);
  }

  public async emergencyStop(tasks: readonly Task[], reason: string): Promise<void> {
    await Promise.all(
      tasks.map((task) =>
        this.#client.workflow.getHandle(task.workflowId).signal("emergencyStop", reason),
      ),
    );
  }

  public async deviceResult(task: Task, result: DeviceCommandResult): Promise<void> {
    await this.#client.workflow.getHandle(task.workflowId).signal("deviceCommandResult", result);
  }
}
