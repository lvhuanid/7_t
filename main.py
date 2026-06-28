import os
import operator
from typing import Literal, List, Dict, Any, Annotated
from IPython.display import Image, display

# 设置 DeepSeek API Key
from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv()

from langchain.tools import tool
from langchain.messages import AnyMessage, SystemMessage, HumanMessage, ToolMessage
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send
from langchain_deepseek import ChatDeepSeek

# ---------- 通用工具定义 ----------
@tool
def multiply(a: int, b: int) -> int:
    """Multiply a and b."""
    return a * b

@tool
def add(a: int, b: int) -> int:
    """Adds a and b."""
    return a + b

@tool
def divide(a: int, b: int) -> float:
    """Divide a and b."""
    return a / b

tools = [add, multiply, divide]
tools_by_name = {tool.name: tool for tool in tools}

# 初始化 LLM（所有模式共用）
model = ChatDeepSeek(model="deepseek-chat", temperature=0)
model_with_tools = model.bind_tools(tools)

# ============================================================
# 模式 1：基础 Agent（你已实现）
# ============================================================
class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    llm_calls: int

def llm_call(state: AgentState):
    return {
        "messages": [model_with_tools.invoke([SystemMessage(content="You are a helpful assistant.")] + state["messages"])],
        "llm_calls": state.get("llm_calls", 0) + 1
    }

def tool_node(state: AgentState):
    result = []
    for tc in state["messages"][-1].tool_calls:
        tool = tools_by_name[tc["name"]]
        result.append(ToolMessage(content=tool.invoke(tc["args"]), tool_call_id=tc["id"]))
    return {"messages": result}

def should_continue(state: AgentState) -> Literal["tool_node", END]:
    return "tool_node" if state["messages"][-1].tool_calls else END

def build_agent():
    builder = StateGraph(AgentState)
    builder.add_node("llm", llm_call).add_node("tool", tool_node)
    builder.add_edge(START, "llm")
    builder.add_conditional_edges("llm", should_continue, ["tool_node", END])
    builder.add_edge("tool_node", "llm")
    return builder.compile()

# ============================================================
# 模式 2：Prompt Chaining（提示链）
# ============================================================
class ChainState(TypedDict):
    topic: str
    joke: str
    translated: str

def generate_joke(state: ChainState):
    # 调用 LLM 生成中文笑话
    response = model.invoke([SystemMessage(content="写一个关于"+state["topic"]+"的短笑话")])
    return {"joke": response.content}

def translate_joke(state: ChainState):
    # 调用 LLM 翻译成英文
    response = model.invoke([SystemMessage(content="将以下中文笑话翻译成英文："+state["joke"])])
    return {"translated": response.content}

def build_chain():
    builder = StateGraph(ChainState)
    builder.add_node("generate", generate_joke)
    builder.add_node("translate", translate_joke)
    builder.add_edge(START, "generate")
    builder.add_edge("generate", "translate")
    builder.add_edge("translate", END)
    return builder.compile()

# ============================================================
# 模式 3：Parallelization（并行化）
# ============================================================
class ParallelState(TypedDict):
    topic: str
    outputs: List[str]  # 存放多个生成结果

def write_joke(state: ParallelState):
    return {"outputs": [model.invoke([SystemMessage(content="写一个关于"+state["topic"]+"的笑话")]).content]}

def write_story(state: ParallelState):
    return {"outputs": [model.invoke([SystemMessage(content="写一个关于"+state["topic"]+"的短故事")]).content]}

def write_poem(state: ParallelState):
    return {"outputs": [model.invoke([SystemMessage(content="写一首关于"+state["topic"]+"的诗")]).content]}

def aggregate(state: ParallelState):
    # 合并结果（此处简单拼接，实际可再用LLM润色）
    combined = "\n\n".join(state["outputs"])
    return {"outputs": [combined]}

def build_parallel():
    builder = StateGraph(ParallelState)
    builder.add_node("joke", write_joke)
    builder.add_node("story", write_story)
    builder.add_node("poem", write_poem)
    builder.add_node("aggregate", aggregate)
    builder.add_edge(START, "joke")
    builder.add_edge(START, "story")
    builder.add_edge(START, "poem")
    builder.add_edge("joke", "aggregate")
    builder.add_edge("story", "aggregate")
    builder.add_edge("poem", "aggregate")
    builder.add_edge("aggregate", END)
    return builder.compile()

# ============================================================
# 模式 4：Routing（路由）
# ============================================================
class RouteState(TypedDict):
    user_input: str
    category: str
    output: str

def classify(state: RouteState):
    # 用 LLM 判断用户输入属于哪一类（笑话/故事/诗歌）
    resp = model.invoke([SystemMessage(content="分类：输入是'笑话'、'故事'还是'诗歌'？只回答一个词。"), HumanMessage(content=state["user_input"])])
    return {"category": resp.content.strip()}

def handle_joke(state: RouteState):
    return {"output": model.invoke([SystemMessage(content="生成一个关于"+state["user_input"]+"的笑话")]).content}

def handle_story(state: RouteState):
    return {"output": model.invoke([SystemMessage(content="生成一个关于"+state["user_input"]+"的故事")]).content}

def handle_poem(state: RouteState):
    return {"output": model.invoke([SystemMessage(content="生成一首关于"+state["user_input"]+"的诗")]).content}

def route_decision(state: RouteState) -> Literal["joke", "story", "poem"]:
    if "笑话" in state["category"]:
        return "joke"
    elif "故事" in state["category"]:
        return "story"
    else:
        return "poem"

def build_routing():
    builder = StateGraph(RouteState)
    builder.add_node("classify", classify)
    builder.add_node("joke", handle_joke)
    builder.add_node("story", handle_story)
    builder.add_node("poem", handle_poem)
    builder.add_edge(START, "classify")
    builder.add_conditional_edges("classify", route_decision, ["joke", "story", "poem"])
    builder.add_edge("joke", END)
    builder.add_edge("story", END)
    builder.add_edge("poem", END)
    return builder.compile()

# ============================================================
# 模式 5：Orchestrator-Worker（编排器-工作者）
# ============================================================
class OrchestratorState(TypedDict):
    topic: str
    outline: List[str]          # 章节标题列表
    sections: Annotated[List[str], operator.add]  # 各章节内容（通过reducer追加）

def plan_outline(state: OrchestratorState):
    # 规划章节大纲
    resp = model.invoke([SystemMessage(content="为关于'"+state["topic"]+"'的报告生成3个章节标题，每行一个。")])
    outline = [line.strip() for line in resp.content.split('\n') if line.strip()]
    return {"outline": outline}

def write_section(state: OrchestratorState, section_title: str):
    # 工作者：根据标题写内容
    content = model.invoke([SystemMessage(content="写一个关于'"+section_title+"'的段落，约50字。")]).content
    return {"sections": [f"## {section_title}\n{content}"]}

# 使用 Send API 动态分发任务
def assign_workers(state: OrchestratorState):
    # 为每个章节创建一个 Send 对象
    return [Send("worker", {"section_title": title}) for title in state["outline"]]

def aggregate_sections(state: OrchestratorState):
    # 合并所有章节
    full_report = "\n\n".join(state["sections"])
    return {"sections": [full_report]}

def build_orchestrator():
    builder = StateGraph(OrchestratorState)
    builder.add_node("planner", plan_outline)
    builder.add_node("worker", write_section)   # 此节点会被动态调用
    builder.add_node("aggregator", aggregate_sections)
    builder.add_edge(START, "planner")
    # 从 planner 经过条件边动态生成多个 worker
    builder.add_conditional_edges("planner", assign_workers, ["worker"])
    builder.add_edge("worker", "aggregator")
    builder.add_edge("aggregator", END)
    return builder.compile()

# ============================================================
# 模式 6：Evaluator-Optimizer（评估器-优化器）
# ============================================================
class EvalState(TypedDict):
    topic: str
    joke: str
    score: int
    attempt: int
    max_attempts: int

def generate(state: EvalState):
    # 根据话题生成笑话
    joke = model.invoke([SystemMessage(content="写一个关于"+state["topic"]+"的笑话")]).content
    return {"joke": joke, "attempt": state.get("attempt", 0) + 1}

def evaluate(state: EvalState):
    # 用 LLM 打分（1-10）
    resp = model.invoke([SystemMessage(content="给以下笑话打分(1-10)，只返回数字。\n"+state["joke"])])
    try:
        score = int(resp.content.strip())
    except:
        score = 5
    return {"score": score}

def should_continue_or_retry(state: EvalState) -> Literal["generate", END]:
    if state["score"] >= 8 or state["attempt"] >= state["max_attempts"]:
        return END
    else:
        return "generate"

def build_evaluator():
    builder = StateGraph(EvalState)
    builder.add_node("generate", generate)
    builder.add_node("evaluate", evaluate)
    builder.add_edge(START, "generate")
    builder.add_edge("generate", "evaluate")
    builder.add_conditional_edges("evaluate", should_continue_or_retry, ["generate", END])
    return builder.compile()

routing_app = build_routing()
result = routing_app.invoke({"user_input": "讲个关于猫的笑话"})
print(result["output"])