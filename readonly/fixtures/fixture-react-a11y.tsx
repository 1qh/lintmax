/* eslint-disable @typescript-eslint/no-unused-vars */
// biome-ignore lint: test fixture
import React from "react";
const props = { id: "x" };
function BooleanValue() {
  return <input disabled={true} readOnly={true} />;
}
function CurlyBracePresence() {
  return <div className={"foo"} id={"bar"}>{"text content"}</div>;
}
function FragmentLong() {
  return (
    <React.Fragment>
      <div />
      <span />
    </React.Fragment>
  );
}
function SpreadMulti() {
  return <div {...props} {...props} />;
}
function SelfClosing() {
  return <div></div>;
}
function SelfClosingSpan() {
  return <span></span>;
}
function AriaInvalidProp() {
  return <div aria-invalidprop="true" aria-fakething="yes" />;
}
function AriaUnsupportedElements() {
  return <meta aria-hidden="true" />;
}
function NoAriaHiddenOnFocusable() {
  return <button aria-hidden="true">click me</button>;
}
function RedundantRoles() {
  return (
    <div>
      <nav role="navigation" />
      <ul role="list" />
      <button role="button" />
    </div>
  );
}
function ScopeOnNonTh() {
  return <div scope="row" />;
}
function TailwindClassOrder() {
  return <div className="flex-col p-4 mt-2 flex items-center mb-4 text-red-500 bg-blue-100 justify-center w-full h-full" />;
}
function TailwindDuplicateClasses() {
  return <div className="flex flex items-center items-center p-4" />;
}
function TailwindUnnecessaryWhitespace() {
  return <div className="  flex   items-center   p-4  " />;
}
function TailwindShorthand() {
  return <div className="pt-4 pr-4 pb-4 pl-4" />;
}
export {
  BooleanValue,
  CurlyBracePresence,
  FragmentLong,
  SpreadMulti,
  SelfClosing,
  SelfClosingSpan,
  AriaInvalidProp,
  AriaUnsupportedElements,
  NoAriaHiddenOnFocusable,
  RedundantRoles,
  ScopeOnNonTh,
  TailwindClassOrder,
  TailwindDuplicateClasses,
  TailwindUnnecessaryWhitespace,
  TailwindShorthand,
  DomAppend,
  DomDataset,
  DomTextContent,
  KeyboardEvent,
  QuerySelector,
  ClasslistToggle,
};
function DomAppend() {
  const el = document.createElement("div")
  const child = document.createElement("span")
  el.appendChild(child)
  return <div />
}
function DomDataset() {
  const el = document.createElement("div")
  el.setAttribute("data-value", "1")
  return <div />
}
function DomTextContent() {
  const el = document.createElement("div")
  const text = el.innerText
  return <div>{text}</div>
}
function KeyboardEvent() {
  document.addEventListener("keydown", (e) => {
    if (e.keyCode === 13) return
  })
  return <div />
}
function QuerySelector() {
  const el = document.getElementById("app")
  return <div>{el?.id}</div>
}
function ClasslistToggle() {
  const el = document.createElement("div")
  if (el.classList.contains("active")) {
    el.classList.remove("active")
  } else {
    el.classList.add("active")
  }
  return <div />
}
